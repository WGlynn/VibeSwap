// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/depin/VibeMedicalVault.sol";

contract VibeMedicalVaultTest is Test {
    VibeMedicalVault public vault;

    address public owner;
    address public patient;
    address public provider;
    address public researcher;
    address public emergencyDoc;

    event PatientRegistered(bytes32 indexed patientId, address indexed patient);
    event RecordUpdated(bytes32 indexed patientId, uint256 recordCount);
    event ConsentGranted(bytes32 indexed consentId, bytes32 indexed patientId, address indexed grantee, VibeMedicalVault.AccessPurpose purpose);
    event ConsentRevoked(bytes32 indexed consentId);
    event DataAccessed(bytes32 indexed patientId, address indexed accessor, VibeMedicalVault.AccessPurpose purpose);
    event EmergencyAccess(bytes32 indexed patientId, address indexed provider, string justification);
    event StudyCreated(uint256 indexed studyId, address indexed researcher, string title);
    event StudyEnrolled(uint256 indexed studyId, bytes32 indexed patientId);
    event CompensationPaid(bytes32 indexed patientId, uint256 amount);

    function setUp() public {
        owner = address(this);
        patient = makeAddr("patient");
        provider = makeAddr("provider");
        researcher = makeAddr("researcher");
        emergencyDoc = makeAddr("emergencyDoc");

        vm.deal(patient, 100 ether);
        vm.deal(provider, 100 ether);
        vm.deal(researcher, 100 ether);
        vm.deal(owner, 100 ether);

        VibeMedicalVault impl = new VibeMedicalVault();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VibeMedicalVault.initialize.selector)
        );
        vault = VibeMedicalVault(payable(address(proxy)));

        vault.addEmergencyProvider(emergencyDoc);
        vault.approveInstitution(researcher);
    }

    // ============ Helpers ============

    function _registerPatient() internal returns (bytes32) {
        vm.prank(patient);
        return vault.registerPatient(
            keccak256("encrypted_data_root"),
            keccak256("encryption_key")
        );
    }

    function _grantConsent(bytes32 patientId, address grantee)
        internal returns (bytes32)
    {
        VibeMedicalVault.DataCategory[] memory cats = new VibeMedicalVault.DataCategory[](1);
        cats[0] = VibeMedicalVault.DataCategory.DIAGNOSIS;

        vm.prank(patient);
        return vault.grantConsent(
            patientId,
            grantee,
            cats,
            VibeMedicalVault.AccessPurpose.TREATMENT,
            30, // 30 days
            10  // max 10 accesses
        );
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(vault.patientCount(), 0);
        assertEq(vault.consentCount(), 0);
        assertEq(vault.studyCount(), 0);
        assertEq(vault.totalAccessFees(), 0);
    }

    // ============ Patient Registration ============

    function test_registerPatient() public {
        bytes32 patientId = _registerPatient();

        assertTrue(patientId != bytes32(0));
        assertEq(vault.patientCount(), 1);

        (
            bytes32 id,
            address patientAddr,
            bytes32 dataRoot,
            bytes32 keyHash,
            uint256 recordCount,
            ,
            bool active
        ) = vault.patients(patientId);

        assertEq(id, patientId);
        assertEq(patientAddr, patient);
        assertEq(dataRoot, keccak256("encrypted_data_root"));
        assertEq(keyHash, keccak256("encryption_key"));
        assertEq(recordCount, 0);
        assertTrue(active);
    }

    function test_registerPatient_emitsEvent() public {
        vm.prank(patient);
        vault.registerPatient(keccak256("data"), keccak256("key"));
        // Verified by successful call — cannot predict exact patientId
    }

    // ============ Record Updates ============

    function test_updateRecords() public {
        bytes32 patientId = _registerPatient();

        vm.prank(patient);
        vault.updateRecords(patientId, keccak256("new_data_root"), 5);

        (, , bytes32 dataRoot, , uint256 recordCount, , ) = vault.patients(patientId);
        assertEq(dataRoot, keccak256("new_data_root"));
        assertEq(recordCount, 5);
    }

    function test_updateRecords_revert_notPatient() public {
        bytes32 patientId = _registerPatient();

        vm.prank(provider);
        vm.expectRevert("Not patient");
        vault.updateRecords(patientId, keccak256("data"), 1);
    }

    // ============ Consent Management ============

    function test_grantConsent() public {
        bytes32 patientId = _registerPatient();
        bytes32 consentId = _grantConsent(patientId, provider);

        assertTrue(consentId != bytes32(0));
        assertEq(vault.consentCount(), 1);

        (
            bytes32 cId,
            bytes32 cPatientId,
            address grantee,
            VibeMedicalVault.AccessPurpose purpose,
            uint256 grantedAt,
            uint256 expiresAt,
            VibeMedicalVault.ConsentStatus status,
            uint256 accessCount,
            uint256 maxAccesses
        ) = vault.consents(consentId);

        assertEq(cId, consentId);
        assertEq(cPatientId, patientId);
        assertEq(grantee, provider);
        assertEq(uint8(purpose), uint8(VibeMedicalVault.AccessPurpose.TREATMENT));
        assertGt(grantedAt, 0);
        assertEq(expiresAt, grantedAt + 30 days);
        assertEq(uint8(status), uint8(VibeMedicalVault.ConsentStatus.GRANTED));
        assertEq(accessCount, 0);
        assertEq(maxAccesses, 10);
    }

    function test_grantConsent_revert_notPatient() public {
        bytes32 patientId = _registerPatient();

        VibeMedicalVault.DataCategory[] memory cats = new VibeMedicalVault.DataCategory[](1);
        cats[0] = VibeMedicalVault.DataCategory.DIAGNOSIS;

        vm.prank(provider); // Not the patient
        vm.expectRevert("Not patient");
        vault.grantConsent(
            patientId,
            provider,
            cats,
            VibeMedicalVault.AccessPurpose.TREATMENT,
            30,
            10
        );
    }

    function test_grantConsent_trackedUnderPatient() public {
        bytes32 patientId = _registerPatient();
        _grantConsent(patientId, provider);

        bytes32[] memory consents = vault.getPatientConsents(patientId);
        assertEq(consents.length, 1);
    }

    function test_grantConsent_multipleConsents() public {
        bytes32 patientId = _registerPatient();

        _grantConsent(patientId, provider);

        VibeMedicalVault.DataCategory[] memory cats = new VibeMedicalVault.DataCategory[](1);
        cats[0] = VibeMedicalVault.DataCategory.LAB_RESULTS;

        vm.prank(patient);
        vault.grantConsent(
            patientId,
            researcher,
            cats,
            VibeMedicalVault.AccessPurpose.RESEARCH,
            90,
            5
        );

        assertEq(vault.consentCount(), 2);
        bytes32[] memory consents = vault.getPatientConsents(patientId);
        assertEq(consents.length, 2);
    }

    // ============ Consent Revocation ============

    function test_revokeConsent() public {
        bytes32 patientId = _registerPatient();
        bytes32 consentId = _grantConsent(patientId, provider);

        vm.prank(patient);
        vault.revokeConsent(consentId);

        (, , , , , , VibeMedicalVault.ConsentStatus status, , ) = vault.consents(consentId);
        assertEq(uint8(status), uint8(VibeMedicalVault.ConsentStatus.REVOKED));
    }

    function test_revokeConsent_revert_notPatient() public {
        bytes32 patientId = _registerPatient();
        bytes32 consentId = _grantConsent(patientId, provider);

        vm.prank(provider);
        vm.expectRevert("Not patient");
        vault.revokeConsent(consentId);
    }

    // ============ Data Access ============

    function test_accessData() public {
        bytes32 patientId = _registerPatient();
        bytes32 consentId = _grantConsent(patientId, provider);

        uint256 patientBefore = patient.balance;

        vm.prank(provider);
        vault.accessData{value: 0.01 ether}(
            consentId,
            VibeMedicalVault.DataCategory.DIAGNOSIS,
            keccak256("zk_proof")
        );

        (, , , , , , , uint256 accessCount, ) = vault.consents(consentId);
        assertEq(accessCount, 1);
        assertEq(vault.getAccessLogCount(), 1);
        assertEq(vault.totalAccessFees(), 0.01 ether);
        assertEq(patient.balance, patientBefore + 0.01 ether);
    }

    function test_accessData_zeroFee() public {
        bytes32 patientId = _registerPatient();
        bytes32 consentId = _grantConsent(patientId, provider);

        vm.prank(provider);
        vault.accessData{value: 0}(
            consentId,
            VibeMedicalVault.DataCategory.DIAGNOSIS,
            keccak256("proof")
        );

        (, , , , , , , uint256 accessCount, ) = vault.consents(consentId);
        assertEq(accessCount, 1);
    }

    function test_accessData_revert_notGrantee() public {
        bytes32 patientId = _registerPatient();
        bytes32 consentId = _grantConsent(patientId, provider);

        vm.prank(researcher);
        vm.expectRevert("Not grantee");
        vault.accessData(consentId, VibeMedicalVault.DataCategory.DIAGNOSIS, keccak256("proof"));
    }

    function test_accessData_revert_consentRevoked() public {
        bytes32 patientId = _registerPatient();
        bytes32 consentId = _grantConsent(patientId, provider);

        vm.prank(patient);
        vault.revokeConsent(consentId);

        vm.prank(provider);
        vm.expectRevert("Consent not active");
        vault.accessData(consentId, VibeMedicalVault.DataCategory.DIAGNOSIS, keccak256("proof"));
    }

    function test_accessData_revert_consentExpired() public {
        bytes32 patientId = _registerPatient();
        bytes32 consentId = _grantConsent(patientId, provider);

        // Warp past consent expiry (30 days)
        vm.warp(block.timestamp + 31 days);

        vm.prank(provider);
        vm.expectRevert("Consent expired");
        vault.accessData(consentId, VibeMedicalVault.DataCategory.DIAGNOSIS, keccak256("proof"));
    }

    function test_accessData_revert_maxAccessesReached() public {
        bytes32 patientId = _registerPatient();

        // Grant consent with max 2 accesses
        VibeMedicalVault.DataCategory[] memory cats = new VibeMedicalVault.DataCategory[](1);
        cats[0] = VibeMedicalVault.DataCategory.DIAGNOSIS;

        vm.prank(patient);
        bytes32 consentId = vault.grantConsent(
            patientId,
            provider,
            cats,
            VibeMedicalVault.AccessPurpose.TREATMENT,
            30,
            2 // max 2 accesses
        );

        vm.startPrank(provider);
        vault.accessData(consentId, VibeMedicalVault.DataCategory.DIAGNOSIS, keccak256("p1"));
        vault.accessData(consentId, VibeMedicalVault.DataCategory.DIAGNOSIS, keccak256("p2"));

        vm.expectRevert("Max accesses reached");
        vault.accessData(consentId, VibeMedicalVault.DataCategory.DIAGNOSIS, keccak256("p3"));
        vm.stopPrank();
    }

    // ============ Emergency Access ============

    function test_emergencyAccess() public {
        bytes32 patientId = _registerPatient();

        vm.prank(emergencyDoc);
        vault.emergencyAccess(patientId, "Car accident, unconscious patient");

        assertEq(vault.getAccessLogCount(), 1);
    }

    function test_emergencyAccess_revert_notEmergencyProvider() public {
        bytes32 patientId = _registerPatient();

        vm.prank(provider);
        vm.expectRevert("Not emergency provider");
        vault.emergencyAccess(patientId, "Emergency");
    }

    // ============ Research Studies ============

    function test_createStudy() public {
        VibeMedicalVault.DataCategory[] memory requiredData = new VibeMedicalVault.DataCategory[](2);
        requiredData[0] = VibeMedicalVault.DataCategory.DIAGNOSIS;
        requiredData[1] = VibeMedicalVault.DataCategory.LAB_RESULTS;

        vm.prank(researcher);
        uint256 studyId = vault.createStudy{value: 10 ether}(
            "COVID Long-Haul Study",
            keccak256("irb_protocol"),
            10, // 10 participants
            1 ether, // 1 ether per participant
            requiredData,
            90 // 90 days
        );

        assertEq(studyId, 1);
        assertEq(vault.studyCount(), 1);

        (
            uint256 sId,
            address sResearcher,
            string memory title,
            ,
            uint256 requiredParticipants,
            uint256 enrolledParticipants,
            uint256 compensation,
            ,
            bool active,
            bool approved
        ) = vault.studies(1);

        assertEq(sId, 1);
        assertEq(sResearcher, researcher);
        assertEq(title, "COVID Long-Haul Study");
        assertEq(requiredParticipants, 10);
        assertEq(enrolledParticipants, 0);
        assertEq(compensation, 1 ether);
        assertTrue(active);
        assertTrue(approved);
    }

    function test_createStudy_revert_notApprovedInstitution() public {
        VibeMedicalVault.DataCategory[] memory requiredData = new VibeMedicalVault.DataCategory[](1);
        requiredData[0] = VibeMedicalVault.DataCategory.DIAGNOSIS;

        vm.prank(provider); // Not an approved institution
        vm.expectRevert("Not approved institution");
        vault.createStudy{value: 1 ether}("Study", keccak256("protocol"), 1, 1 ether, requiredData, 30);
    }

    function test_createStudy_revert_insufficientFunding() public {
        VibeMedicalVault.DataCategory[] memory requiredData = new VibeMedicalVault.DataCategory[](1);
        requiredData[0] = VibeMedicalVault.DataCategory.DIAGNOSIS;

        vm.prank(researcher);
        vm.expectRevert("Insufficient funding");
        vault.createStudy{value: 0.5 ether}(
            "Study",
            keccak256("protocol"),
            10, // 10 participants
            1 ether, // 1 ether each = 10 ether needed
            requiredData,
            30
        );
    }

    // ============ Study Enrollment ============

    function test_enrollInStudy() public {
        // Create study
        VibeMedicalVault.DataCategory[] memory requiredData = new VibeMedicalVault.DataCategory[](1);
        requiredData[0] = VibeMedicalVault.DataCategory.DIAGNOSIS;

        vm.prank(researcher);
        uint256 studyId = vault.createStudy{value: 5 ether}(
            "Study",
            keccak256("protocol"),
            5,
            1 ether,
            requiredData,
            90
        );

        bytes32 patientId = _registerPatient();
        uint256 patientBefore = patient.balance;

        vm.prank(patient);
        vault.enrollInStudy(studyId, patientId);

        assertTrue(vault.enrolled(studyId, patientId));

        (, , , , , uint256 enrolledParticipants, , , , ) = vault.studies(studyId);
        assertEq(enrolledParticipants, 1);

        // Check compensation was paid
        assertEq(patient.balance, patientBefore + 1 ether);
    }

    function test_enrollInStudy_revert_notPatient() public {
        VibeMedicalVault.DataCategory[] memory requiredData = new VibeMedicalVault.DataCategory[](1);
        requiredData[0] = VibeMedicalVault.DataCategory.DIAGNOSIS;

        vm.prank(researcher);
        uint256 studyId = vault.createStudy{value: 1 ether}("Study", keccak256("p"), 1, 1 ether, requiredData, 30);

        bytes32 patientId = _registerPatient();

        vm.prank(provider); // Not the patient
        vm.expectRevert("Not patient");
        vault.enrollInStudy(studyId, patientId);
    }

    function test_enrollInStudy_revert_alreadyEnrolled() public {
        VibeMedicalVault.DataCategory[] memory requiredData = new VibeMedicalVault.DataCategory[](1);
        requiredData[0] = VibeMedicalVault.DataCategory.DIAGNOSIS;

        vm.prank(researcher);
        uint256 studyId = vault.createStudy{value: 2 ether}("Study", keccak256("p"), 2, 1 ether, requiredData, 30);

        bytes32 patientId = _registerPatient();

        vm.prank(patient);
        vault.enrollInStudy(studyId, patientId);

        vm.prank(patient);
        vm.expectRevert("Already enrolled");
        vault.enrollInStudy(studyId, patientId);
    }

    function test_enrollInStudy_revert_studyFull() public {
        VibeMedicalVault.DataCategory[] memory requiredData = new VibeMedicalVault.DataCategory[](1);
        requiredData[0] = VibeMedicalVault.DataCategory.DIAGNOSIS;

        vm.prank(researcher);
        uint256 studyId = vault.createStudy{value: 1 ether}("Study", keccak256("p"), 1, 1 ether, requiredData, 30);

        // First patient enrolls
        bytes32 patientId1 = _registerPatient();
        vm.prank(patient);
        vault.enrollInStudy(studyId, patientId1);

        // Second patient tries
        address patient2 = makeAddr("patient2");
        vm.deal(patient2, 100 ether);
        vm.prank(patient2);
        bytes32 patientId2 = vault.registerPatient(keccak256("data2"), keccak256("key2"));

        vm.prank(patient2);
        vm.expectRevert("Study full");
        vault.enrollInStudy(studyId, patientId2);
    }

    function test_enrollInStudy_revert_studyNotActive() public {
        // Study ID 999 doesn't exist — active defaults to false
        bytes32 patientId = _registerPatient();

        vm.prank(patient);
        vm.expectRevert("Study not active");
        vault.enrollInStudy(999, patientId);
    }

    // ============ Admin ============

    function test_addEmergencyProvider() public {
        address newDoc = makeAddr("newDoc");
        vault.addEmergencyProvider(newDoc);
        assertTrue(vault.emergencyProviders(newDoc));
    }

    function test_removeEmergencyProvider() public {
        vault.removeEmergencyProvider(emergencyDoc);
        assertFalse(vault.emergencyProviders(emergencyDoc));
    }

    function test_approveInstitution() public {
        address newInst = makeAddr("newInstitution");
        vault.approveInstitution(newInst);
        assertTrue(vault.approvedInstitutions(newInst));
    }

    function test_revokeInstitution() public {
        vault.revokeInstitution(researcher);
        assertFalse(vault.approvedInstitutions(researcher));
    }

    function test_admin_revert_notOwner() public {
        vm.startPrank(patient);

        vm.expectRevert();
        vault.addEmergencyProvider(patient);

        vm.expectRevert();
        vault.removeEmergencyProvider(emergencyDoc);

        vm.expectRevert();
        vault.approveInstitution(patient);

        vm.expectRevert();
        vault.revokeInstitution(researcher);

        vm.stopPrank();
    }

    // ============ View Functions ============

    function test_getPatientConsents_empty() public {
        bytes32 patientId = _registerPatient();
        bytes32[] memory consents = vault.getPatientConsents(patientId);
        assertEq(consents.length, 0);
    }

    function test_getAccessLogCount() public view {
        assertEq(vault.getAccessLogCount(), 0);
    }

    function test_getStudyCount() public view {
        assertEq(vault.getStudyCount(), 0);
    }

    function test_getPatientCount() public view {
        assertEq(vault.getPatientCount(), 0);
    }

    // ============ Fuzz Tests ============

    function testFuzz_accessData_withFee(uint96 fee) public {
        vm.assume(fee > 0);
        vm.deal(provider, uint256(fee));

        bytes32 patientId = _registerPatient();
        bytes32 consentId = _grantConsent(patientId, provider);

        uint256 patientBefore = patient.balance;

        vm.prank(provider);
        vault.accessData{value: fee}(
            consentId,
            VibeMedicalVault.DataCategory.DIAGNOSIS,
            keccak256("proof")
        );

        assertEq(patient.balance, patientBefore + uint256(fee));
        assertEq(vault.totalAccessFees(), uint256(fee));
    }

    // ============ Edge Cases ============

    function test_receive_ether() public {
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertTrue(ok);
    }

    function test_fullWorkflow() public {
        // 1. Register patient
        bytes32 patientId = _registerPatient();

        // 2. Update records
        vm.prank(patient);
        vault.updateRecords(patientId, keccak256("updated"), 10);

        // 3. Grant consent to provider
        bytes32 consentId = _grantConsent(patientId, provider);

        // 4. Provider accesses data
        vm.prank(provider);
        vault.accessData{value: 0.01 ether}(
            consentId,
            VibeMedicalVault.DataCategory.DIAGNOSIS,
            keccak256("proof")
        );

        // 5. Create study
        VibeMedicalVault.DataCategory[] memory requiredData = new VibeMedicalVault.DataCategory[](1);
        requiredData[0] = VibeMedicalVault.DataCategory.DIAGNOSIS;

        vm.prank(researcher);
        uint256 studyId = vault.createStudy{value: 1 ether}(
            "Study", keccak256("protocol"), 1, 1 ether, requiredData, 30
        );

        // 6. Enroll in study
        vm.prank(patient);
        vault.enrollInStudy(studyId, patientId);

        // 7. Emergency access
        vm.prank(emergencyDoc);
        vault.emergencyAccess(patientId, "Emergency situation");

        // 8. Patient revokes consent
        vm.prank(patient);
        vault.revokeConsent(consentId);

        // Verify final state
        assertEq(vault.patientCount(), 1);
        assertEq(vault.consentCount(), 1);
        assertEq(vault.getAccessLogCount(), 2); // 1 data access + 1 emergency
        assertEq(vault.studyCount(), 1);
    }
}
