// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./interfaces/IHarbergerLicense.sol";

/**
 * @title HarbergerLicense
 * @notice Premium feature licenses via Harberger tax (self-assessment + continuous tax + force-buy)
 * @dev Holders self-assess value and pay continuous tax. Anyone can buy at the assessed price.
 *      Tax accrual = assessedValue * taxRateBps * elapsed / (10000 * SECONDS_PER_YEAR).
 *      Force buy = pay exactly assessedValue to current holder + deposit tax for new assessment.
 *      Cooperative Capitalism: efficient allocation via continuous cost of ownership.
 */
contract HarbergerLicense is Ownable, ReentrancyGuard, IHarbergerLicense {
    // ============ Constants ============

    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant MAX_TAX_RATE_BPS = 5000; // 50% max annual
    uint256 public constant MIN_TAX_DEPOSIT_PERIODS = 1; // Must deposit at least 1 period of tax

    // ============ State ============

    /// @notice Number of licenses created
    uint256 public licenseCount;

    /// @notice Minimum self-assessed value
    uint256 public minAssessedValue;

    /// @notice Grace period before delinquent license can be revoked
    uint256 public gracePeriod;

    /// @notice Treasury address for collected taxes
    address public treasury;

    /// @notice Licenses by ID (1-indexed)
    mapping(uint256 => License) internal _licenses;

    /// @notice Track when delinquency started (for grace period)
    mapping(uint256 => uint256) public delinquentSince;

    // ============ Constructor ============

    constructor(address _treasury) Ownable(msg.sender) {
        treasury = _treasury;
        minAssessedValue = 0.01 ether;
        gracePeriod = 7 days;
    }

    // ============ Core Functions ============

    /// @inheritdoc IHarbergerLicense
    function createLicense(
        string calldata featureName,
        uint256 taxRateBps
    ) external onlyOwner returns (uint256 licenseId) {
        if (bytes(featureName).length == 0) revert ZeroName();
        require(taxRateBps > 0 && taxRateBps <= MAX_TAX_RATE_BPS, "Invalid tax rate");

        licenseId = ++licenseCount;

        _licenses[licenseId] = License({
            featureName: featureName,
            holder: address(0),
            assessedValue: 0,
            taxRateBps: taxRateBps,
            lastTaxPaid: 0,
            taxBalance: 0,
            state: LicenseState.VACANT
        });

        emit LicenseCreated(licenseId, featureName, taxRateBps);
    }

    /// @inheritdoc IHarbergerLicense
    function claimLicense(
        uint256 licenseId,
        uint256 assessedValue
    ) external payable nonReentrant {
        License storage license = _licenses[licenseId];
        if (bytes(license.featureName).length == 0) revert LicenseNotFound();
        if (license.state != LicenseState.VACANT) revert LicenseNotVacant();
        if (assessedValue < minAssessedValue) revert AssessmentTooLow();

        // Must deposit at least 1 period's worth of tax
        uint256 minTaxDeposit = _computeTax(assessedValue, license.taxRateBps, gracePeriod);
        if (msg.value < minTaxDeposit) revert InsufficientTaxDeposit();

        license.holder = msg.sender;
        license.assessedValue = assessedValue;
        license.lastTaxPaid = block.timestamp;
        license.taxBalance = msg.value;
        license.state = LicenseState.ACTIVE;

        emit LicenseClaimed(licenseId, msg.sender, assessedValue, msg.value);
    }

    /// @inheritdoc IHarbergerLicense
    function changeAssessment(uint256 licenseId, uint256 newValue) external {
        License storage license = _licenses[licenseId];
        if (bytes(license.featureName).length == 0) revert LicenseNotFound();
        if (license.holder != msg.sender) revert NotLicenseHolder();
        if (license.state != LicenseState.ACTIVE) revert LicenseNotActive();
        if (newValue < minAssessedValue) revert AssessmentTooLow();

        // Collect accrued tax before changing assessment
        _collectTaxInternal(licenseId);

        uint256 oldValue = license.assessedValue;
        license.assessedValue = newValue;

        // Check if remaining balance covers at least some future tax
        _checkDelinquency(licenseId);

        emit AssessmentChanged(licenseId, oldValue, newValue);
    }

    /// @inheritdoc IHarbergerLicense
    function forceBuy(
        uint256 licenseId,
        uint256 newAssessedValue
    ) external payable nonReentrant {
        License storage license = _licenses[licenseId];
        if (bytes(license.featureName).length == 0) revert LicenseNotFound();
        if (license.state != LicenseState.ACTIVE && license.state != LicenseState.DELINQUENT) {
            revert LicenseNotActive();
        }
        if (license.holder == msg.sender) revert CannotBuyOwnLicense();
        if (newAssessedValue < minAssessedValue) revert AssessmentTooLow();

        // Collect outstanding tax first
        _collectTaxInternal(licenseId);

        // Buyer must pay assessed value to current holder + tax deposit for new assessment
        uint256 purchasePrice = license.assessedValue;
        uint256 minTaxDeposit = _computeTax(newAssessedValue, license.taxRateBps, gracePeriod);
        uint256 totalRequired = purchasePrice + minTaxDeposit;
        if (msg.value < totalRequired) revert InsufficientPayment();

        address oldHolder = license.holder;
        uint256 remainingTaxBalance = license.taxBalance;

        // Transfer to new holder
        license.holder = msg.sender;
        license.assessedValue = newAssessedValue;
        license.lastTaxPaid = block.timestamp;
        license.taxBalance = msg.value - purchasePrice;
        license.state = LicenseState.ACTIVE;
        delinquentSince[licenseId] = 0;

        // Pay old holder: purchase price + their remaining tax balance
        uint256 holderPayout = purchasePrice + remainingTaxBalance;
        if (holderPayout > 0) {
            (bool success, ) = oldHolder.call{value: holderPayout}("");
            require(success, "Payout failed");
        }

        emit ForceBuy(licenseId, oldHolder, msg.sender, purchasePrice);
    }

    /// @inheritdoc IHarbergerLicense
    function depositTax(uint256 licenseId) external payable {
        License storage license = _licenses[licenseId];
        if (bytes(license.featureName).length == 0) revert LicenseNotFound();
        if (msg.value == 0) revert ZeroAmount();

        license.taxBalance += msg.value;

        // If was delinquent and now has balance, restore active
        if (license.state == LicenseState.DELINQUENT) {
            license.state = LicenseState.ACTIVE;
            delinquentSince[licenseId] = 0;
        }

        emit TaxDeposited(licenseId, msg.sender, msg.value);
    }

    /// @inheritdoc IHarbergerLicense
    function collectTax(uint256 licenseId) external {
        License storage license = _licenses[licenseId];
        if (bytes(license.featureName).length == 0) revert LicenseNotFound();
        if (license.holder == address(0)) revert LicenseNotActive();

        uint256 collected = _collectTaxInternal(licenseId);
        if (collected == 0) revert NoTaxToCollect();
    }

    /// @inheritdoc IHarbergerLicense
    function revokeLicense(uint256 licenseId) external {
        License storage license = _licenses[licenseId];
        if (bytes(license.featureName).length == 0) revert LicenseNotFound();
        if (license.state != LicenseState.DELINQUENT) revert LicenseNotDelinquent();

        uint256 dSince = delinquentSince[licenseId];
        if (block.timestamp < dSince + gracePeriod) revert GracePeriodNotExpired();

        address oldHolder = license.holder;

        // Collect any remaining tax
        _collectTaxInternal(licenseId);

        // Refund any remaining tax balance to holder
        uint256 remaining = license.taxBalance;
        license.taxBalance = 0;

        // Reset license to vacant
        license.holder = address(0);
        license.assessedValue = 0;
        license.lastTaxPaid = 0;
        license.state = LicenseState.VACANT;
        delinquentSince[licenseId] = 0;

        if (remaining > 0) {
            (bool success, ) = oldHolder.call{value: remaining}("");
            require(success, "Refund failed");
        }

        emit LicenseRevoked(licenseId, oldHolder);
    }

    // ============ Internal Functions ============

    /**
     * @notice Compute tax for a given assessed value, rate, and time period
     * @dev tax = assessedValue * taxRateBps * elapsed / (10000 * SECONDS_PER_YEAR)
     */
    function _computeTax(
        uint256 assessedValue,
        uint256 taxRateBps,
        uint256 elapsed
    ) internal pure returns (uint256) {
        return (assessedValue * taxRateBps * elapsed) / (10000 * SECONDS_PER_YEAR);
    }

    /**
     * @notice Collect accrued tax and send to treasury
     * @return collected Amount of tax collected
     */
    function _collectTaxInternal(uint256 licenseId) internal returns (uint256 collected) {
        License storage license = _licenses[licenseId];
        if (license.holder == address(0) || license.lastTaxPaid == 0) return 0;

        uint256 elapsed = block.timestamp - license.lastTaxPaid;
        if (elapsed == 0) return 0;

        uint256 owed = _computeTax(license.assessedValue, license.taxRateBps, elapsed);

        if (owed >= license.taxBalance) {
            // Collect everything, mark delinquent
            collected = license.taxBalance;
            license.taxBalance = 0;
        } else {
            collected = owed;
            license.taxBalance -= owed;
        }

        license.lastTaxPaid = block.timestamp;

        // Send to treasury
        if (collected > 0 && treasury != address(0)) {
            (bool success, ) = treasury.call{value: collected}("");
            require(success, "Treasury transfer failed");
        }

        // Check delinquency after collection
        _checkDelinquency(licenseId);

        if (collected > 0) {
            emit TaxCollected(licenseId, collected);
        }
    }

    /**
     * @notice Check if license is delinquent (zero tax balance)
     */
    function _checkDelinquency(uint256 licenseId) internal {
        License storage license = _licenses[licenseId];
        if (license.taxBalance == 0 && license.state == LicenseState.ACTIVE) {
            license.state = LicenseState.DELINQUENT;
            delinquentSince[licenseId] = block.timestamp;
        }
    }

    // ============ View Functions ============

    /// @inheritdoc IHarbergerLicense
    function accruedTax(uint256 licenseId) external view returns (uint256) {
        License storage license = _licenses[licenseId];
        if (license.holder == address(0) || license.lastTaxPaid == 0) return 0;

        uint256 elapsed = block.timestamp - license.lastTaxPaid;
        return _computeTax(license.assessedValue, license.taxRateBps, elapsed);
    }

    /// @inheritdoc IHarbergerLicense
    function isHolding(uint256 licenseId, address holder) external view returns (bool) {
        return _licenses[licenseId].holder == holder &&
               _licenses[licenseId].state == LicenseState.ACTIVE;
    }

    /// @inheritdoc IHarbergerLicense
    function getLicense(uint256 licenseId) external view returns (License memory) {
        return _licenses[licenseId];
    }

    // ============ Admin Functions ============

    function setMinAssessedValue(uint256 _minValue) external onlyOwner {
        uint256 old = minAssessedValue;
        minAssessedValue = _minValue;
        emit MinAssessedValueUpdated(old, _minValue);
    }

    function setGracePeriod(uint256 _gracePeriod) external onlyOwner {
        uint256 old = gracePeriod;
        gracePeriod = _gracePeriod;
        emit GracePeriodUpdated(old, _gracePeriod);
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function setTaxRate(uint256 licenseId, uint256 newRateBps) external onlyOwner {
        License storage license = _licenses[licenseId];
        if (bytes(license.featureName).length == 0) revert LicenseNotFound();
        require(newRateBps > 0 && newRateBps <= MAX_TAX_RATE_BPS, "Invalid tax rate");

        // Collect at old rate first
        if (license.holder != address(0)) {
            _collectTaxInternal(licenseId);
        }

        uint256 oldRate = license.taxRateBps;
        license.taxRateBps = newRateBps;

        emit TaxRateUpdated(licenseId, oldRate, newRateBps);
    }

    receive() external payable {}
}
