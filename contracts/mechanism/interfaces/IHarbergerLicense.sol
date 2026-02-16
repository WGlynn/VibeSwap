// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IHarbergerLicense
 * @notice Interface for Harberger-taxed premium feature licenses
 * @dev Self-assess value, pay continuous tax, anyone can buy at your price.
 *      Efficient allocation of scarce protocol resources (pool names, featured listings).
 *      Cooperative Capitalism: prevents rent-seeking via continuous cost of ownership.
 */
interface IHarbergerLicense {
    // ============ Enums ============

    enum LicenseState {
        VACANT,
        ACTIVE,
        DELINQUENT
    }

    // ============ Structs ============

    struct License {
        string featureName;
        address holder;
        uint256 assessedValue;
        uint256 taxRateBps;
        uint256 lastTaxPaid;
        uint256 taxBalance;
        LicenseState state;
    }

    // ============ Events ============

    event LicenseCreated(
        uint256 indexed licenseId,
        string featureName,
        uint256 taxRateBps
    );

    event LicenseClaimed(
        uint256 indexed licenseId,
        address indexed holder,
        uint256 assessedValue,
        uint256 initialTaxDeposit
    );

    event AssessmentChanged(
        uint256 indexed licenseId,
        uint256 oldValue,
        uint256 newValue
    );

    event ForceBuy(
        uint256 indexed licenseId,
        address indexed oldHolder,
        address indexed newHolder,
        uint256 purchasePrice
    );

    event TaxDeposited(uint256 indexed licenseId, address indexed depositor, uint256 amount);
    event TaxCollected(uint256 indexed licenseId, uint256 amount);
    event LicenseRevoked(uint256 indexed licenseId, address indexed holder);
    event TaxRateUpdated(uint256 indexed licenseId, uint256 oldRate, uint256 newRate);
    event MinAssessedValueUpdated(uint256 oldValue, uint256 newValue);
    event GracePeriodUpdated(uint256 oldPeriod, uint256 newPeriod);

    // ============ Errors ============

    error LicenseNotFound();
    error LicenseNotVacant();
    error LicenseNotActive();
    error LicenseNotDelinquent();
    error NotLicenseHolder();
    error AssessmentTooLow();
    error InsufficientTaxDeposit();
    error InsufficientPayment();
    error CannotBuyOwnLicense();
    error ZeroAmount();
    error ZeroName();
    error GracePeriodNotExpired();
    error NoTaxToCollect();
    error LicenseAlreadyExists();

    // ============ Core Functions ============

    function createLicense(string calldata featureName, uint256 taxRateBps) external returns (uint256 licenseId);

    function claimLicense(uint256 licenseId, uint256 assessedValue) external payable;

    function changeAssessment(uint256 licenseId, uint256 newValue) external;

    function forceBuy(uint256 licenseId, uint256 newAssessedValue) external payable;

    function depositTax(uint256 licenseId) external payable;

    function collectTax(uint256 licenseId) external;

    function revokeLicense(uint256 licenseId) external;

    // ============ View Functions ============

    function accruedTax(uint256 licenseId) external view returns (uint256);

    function isHolding(uint256 licenseId, address holder) external view returns (bool);

    function getLicense(uint256 licenseId) external view returns (License memory);

    function licenseCount() external view returns (uint256);
}
