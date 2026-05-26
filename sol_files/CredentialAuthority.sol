// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Keeps the list of institutions that are allowed to issue credentials.
// The deployer becomes the accreditation authority and is the only account that
// can register or deactivate institutions.
contract InstitutionRegistry {
    address public immutable accreditationAuthority;

    struct Institution {
        string name;
        bool active;
        uint256 registeredAt;
        uint256 deactivatedAt;
    }

    mapping(address => Institution) private institutions;

    event InstitutionRegistered(address indexed institution, string name);
    event InstitutionDeactivated(address indexed institution);

    // Restricts institution management to the wallet that deployed this registry.
    modifier onlyAccreditationAuthority() {
        require(
            msg.sender == accreditationAuthority,
            "Only accreditation authority"
        );
        _;
    }

    constructor() {
        accreditationAuthority = msg.sender;
    }

    // Adds or reactivates an institution so it can issue credentials.
    function registerInstitution(
        address institution,
        string calldata name
    ) external onlyAccreditationAuthority {
        require(institution != address(0), "Invalid institution address");
        require(bytes(name).length > 0, "Institution name required");

        institutions[institution] = Institution({
            name: name,
            active: true,
            registeredAt: block.timestamp,
            deactivatedAt: 0
        });

        emit InstitutionRegistered(institution, name);
    }

    // Marks an institution as inactive without deleting its history.
    function deactivateInstitution(
        address institution
    ) external onlyAccreditationAuthority {
        require(institutions[institution].registeredAt != 0, "Not registered");
        require(institutions[institution].active, "Already inactive");

        institutions[institution].active = false;
        institutions[institution].deactivatedAt = block.timestamp;

        emit InstitutionDeactivated(institution);
    }

    // Returns whether an institution is currently approved to issue.
    function verifyInstitution(
        address institution
    ) external view returns (bool) {
        return institutions[institution].active;
    }

    // Returns the stored institution details for admin or UI display.
    function getInstitution(
        address institution
    ) external view returns (Institution memory) {
        return institutions[institution];
    }
}

// Stores every issued credential and tracks them by issuer and holder.
// Acts as the source of truth for credential metadata, while lifecycle updates are
// delegated to LifecycleAndAccessControl after the contracts are linked.
contract CredentialRegistry {
    InstitutionRegistry public immutable institutionRegistry;
    address public immutable registryAdmin;
    address public lifecycleContract;
    address public verificationContract;

    enum CredentialStatus {
        Unknown,
        Active,
        Cancelled,
        Superseded
    }

    struct Credential {
        address issuer;
        address holder;
        bytes32 studentReference;
        bytes32 documentHash;
        string credentialType;
        uint256 issuedAt;
        CredentialStatus status;
        bytes32 replacementCredentialId;
    }

    struct CredentialRecord {
        bytes32 credentialId;
        Credential credential;
    }

    mapping(bytes32 => Credential) private credentials;
    mapping(address => bytes32[]) private issuerCredentials;
    mapping(address => bytes32[]) private holderCredentials;

    event CredentialIssued(
        bytes32 indexed credentialId,
        address indexed issuer,
        address indexed holder,
        bytes32 studentReference,
        string credentialType
    );
    event LifecycleContractUpdated(address indexed lifecycleContract);
    event VerificationContractUpdated(address indexed verificationContract);
    event CredentialStatusUpdated(
        bytes32 indexed credentialId,
        CredentialStatus status,
        bytes32 replacementCredentialId
    );

    // Allows only active institutions from InstitutionRegistry to issue credentials.
    modifier onlyApprovedInstitution() {
        require(
            institutionRegistry.verifyInstitution(msg.sender),
            "Issuer is not approved"
        );
        _;
    }

    // Limits lifecycle changes, such as revocation or replacement, to the lifecycle contract.
    modifier onlyLifecycleContract() {
        require(msg.sender == lifecycleContract, "Only lifecycle contract");
        _;
    }

    // Allows one-time wiring of related contracts by the registry deployer.
    modifier onlyRegistryAdmin() {
        require(msg.sender == registryAdmin, "Only registry admin");
        _;
    }

    // Protects full credential details from arbitrary public reads.
    modifier onlyCredentialReader(bytes32 credentialId) {
        Credential storage credential = credentials[credentialId];
        require(credential.status != CredentialStatus.Unknown, "Not found");
        require(
            msg.sender == registryAdmin ||
                msg.sender == credential.issuer ||
                msg.sender == credential.holder ||
                msg.sender == lifecycleContract ||
                msg.sender == verificationContract,
            "Not authorised to read credential"
        );
        _;
    }

    constructor(address institutionRegistryAddress) {
        require(
            institutionRegistryAddress != address(0),
            "Invalid registry address"
        );
        institutionRegistry = InstitutionRegistry(institutionRegistryAddress);
        registryAdmin = msg.sender;
    }

    // Links the registry to the lifecycle contract after deployment.
    function setLifecycleContract(
        address newLifecycleContract
    ) external onlyRegistryAdmin {
        require(lifecycleContract == address(0), "Lifecycle already set");
        require(
            newLifecycleContract != address(0),
            "Invalid lifecycle address"
        );

        lifecycleContract = newLifecycleContract;
        emit LifecycleContractUpdated(newLifecycleContract);
    }

    // Links the registry to the verification contract after deployment.
    function setVerificationContract(
        address newVerificationContract
    ) external onlyRegistryAdmin {
        require(verificationContract == address(0), "Verification already set");
        require(
            newVerificationContract != address(0),
            "Invalid verification address"
        );

        verificationContract = newVerificationContract;
        emit VerificationContractUpdated(newVerificationContract);
    }

    // Issues a new active credential from an approved institution to a holder.
    function issueCredential(
        address holder,
        bytes32 studentReference,
        bytes32 documentHash,
        string calldata credentialType
    ) external onlyApprovedInstitution returns (bytes32) {
        return
            _createCredential(
                msg.sender,
                holder,
                studentReference,
                documentHash,
                credentialType
            );
    }

    // Creates a replacement credential and marks the old credential as superseded.
    function replaceCredential(
        bytes32 oldCredentialId,
        bytes32 studentReference,
        bytes32 documentHash,
        string calldata credentialType,
        address issuer
    ) external onlyLifecycleContract returns (bytes32) {
        Credential storage oldCredential = credentials[oldCredentialId];
        require(oldCredential.status != CredentialStatus.Unknown, "Not found");
        require(
            oldCredential.status == CredentialStatus.Active,
            "Replacement source must be active"
        );
        require(oldCredential.issuer == issuer, "Only credential issuer");
        require(
            institutionRegistry.verifyInstitution(issuer),
            "Issuer is not approved"
        );

        bytes32 newCredentialId = _createCredential(
            issuer,
            oldCredential.holder,
            studentReference,
            documentHash,
            credentialType
        );

        oldCredential.status = CredentialStatus.Superseded;
        oldCredential.replacementCredentialId = newCredentialId;

        emit CredentialStatusUpdated(
            oldCredentialId,
            CredentialStatus.Superseded,
            newCredentialId
        );

        return newCredentialId;
    }

    // Shared credential creation logic used by initial issue and replacement.
    function _createCredential(
        address issuer,
        address holder,
        bytes32 studentReference,
        bytes32 documentHash,
        string memory credentialType
    ) private returns (bytes32) {
        require(holder != address(0), "Invalid holder address");
        require(studentReference != bytes32(0), "Student reference required");
        require(documentHash != bytes32(0), "Document hash required");
        require(bytes(credentialType).length > 0, "Credential type required");

        bytes32 credentialId = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                issuer,
                holder,
                studentReference,
                documentHash,
                credentialType,
                issuerCredentials[issuer].length
            )
        );

        require(
            credentials[credentialId].status == CredentialStatus.Unknown,
            "Credential already exists"
        );

        credentials[credentialId] = Credential({
            issuer: issuer,
            holder: holder,
            studentReference: studentReference,
            documentHash: documentHash,
            credentialType: credentialType,
            issuedAt: block.timestamp,
            status: CredentialStatus.Active,
            replacementCredentialId: bytes32(0)
        });
        issuerCredentials[issuer].push(credentialId);
        holderCredentials[holder].push(credentialId);

        emit CredentialIssued(
            credentialId,
            issuer,
            holder,
            studentReference,
            credentialType
        );

        return credentialId;
    }

    // Lets the lifecycle contract update a credential's current status.
    function updateCredentialStatus(
        bytes32 credentialId,
        CredentialStatus status,
        bytes32 replacementCredentialId
    ) external onlyLifecycleContract {
        require(
            credentials[credentialId].status != CredentialStatus.Unknown,
            "Not found"
        );
        require(status != CredentialStatus.Unknown, "Invalid status");

        credentials[credentialId].status = status;
        credentials[credentialId]
            .replacementCredentialId = replacementCredentialId;

        emit CredentialStatusUpdated(
            credentialId,
            status,
            replacementCredentialId
        );
    }

    // Returns full credential metadata to authorised registry readers.
    function getCredential(
        bytes32 credentialId
    ) external view onlyCredentialReader(credentialId) returns (Credential memory) {
        return credentials[credentialId];
    }

    // Returns just the status, which is safe for verification checks.
    function getCredentialStatus(
        bytes32 credentialId
    ) external view returns (CredentialStatus) {
        return credentials[credentialId].status;
    }

    // Returns the stored document hash for hash comparison.
    function getDocumentHash(
        bytes32 credentialId
    ) external view returns (bytes32) {
        return credentials[credentialId].documentHash;
    }

    // Returns the issuer address for access-control and verification checks.
    function getIssuer(bytes32 credentialId) external view returns (address) {
        return credentials[credentialId].issuer;
    }

    // Returns the holder address, but only to trusted contracts or related parties.
    function getHolder(bytes32 credentialId) external view returns (address) {
        Credential storage credential = credentials[credentialId];
        require(credential.status != CredentialStatus.Unknown, "Not found");
        require(
            msg.sender == registryAdmin ||
                msg.sender == credential.issuer ||
                msg.sender == credential.holder ||
                msg.sender == lifecycleContract ||
                msg.sender == verificationContract,
            "Not authorised to read holder"
        );

        return credentials[credentialId].holder;
    }

    // Lists credentials issued by the connected wallet.
    function getMyIssuerCredentials()
        external
        view
        returns (CredentialRecord[] memory)
    {
        return _buildCredentialRecords(issuerCredentials[msg.sender]);
    }

    // Lists credentials held by the connected wallet.
    function getMyHolderCredentials()
        external
        view
        returns (CredentialRecord[] memory)
    {
        return _buildCredentialRecords(holderCredentials[msg.sender]);
    }

    // Converts stored credential IDs into full records for UI-friendly reads.
    function _buildCredentialRecords(
        bytes32[] storage credentialIds
    ) private view returns (CredentialRecord[] memory) {
        CredentialRecord[] memory credentialRecords = new CredentialRecord[](
            credentialIds.length
        );

        for (uint256 i = 0; i < credentialIds.length; i++) {
            bytes32 credentialId = credentialIds[i];
            credentialRecords[i] = CredentialRecord({
                credentialId: credentialId,
                credential: credentials[credentialId]
            });
        }

        return credentialRecords;
    }
}

// Handles actions that happen after a credential has been issued.
// Issuers can revoke or replace their own credentials, while holders control
// which verifier wallets are allowed to view protected metadata.
contract LifecycleAndAccessControl {
    CredentialRegistry public immutable credentialRegistry;

    mapping(bytes32 => mapping(address => bool)) private credentialAccess;

    event CredentialRevoked(
        bytes32 indexed credentialId,
        address indexed issuer
    );
    event CredentialReplaced(
        bytes32 indexed oldCredentialId,
        bytes32 indexed newCredentialId,
        address indexed issuer
    );
    event AccessGranted(
        bytes32 indexed credentialId,
        address indexed student,
        address indexed verifier
    );
    event AccessRevoked(
        bytes32 indexed credentialId,
        address indexed student,
        address indexed verifier
    );
    event VerificationLogged(
        bytes32 indexed credentialId,
        address indexed verifier,
        bool successful,
        uint256 verifiedAt
    );

    // Ensures only the original issuer can revoke or replace its credential.
    modifier onlyCredentialIssuer(bytes32 credentialId) {
        require(
            credentialRegistry.getIssuer(credentialId) == msg.sender,
            "Only credential issuer"
        );
        _;
    }

    constructor(address credentialRegistryAddress) {
        require(
            credentialRegistryAddress != address(0),
            "Invalid credential registry"
        );
        credentialRegistry = CredentialRegistry(credentialRegistryAddress);
    }

    // Cancels an active credential issued by the caller.
    function revokeCredential(
        bytes32 credentialId
    ) external onlyCredentialIssuer(credentialId) {
        credentialRegistry.updateCredentialStatus(
            credentialId,
            CredentialRegistry.CredentialStatus.Cancelled,
            bytes32(0)
        );

        emit CredentialRevoked(credentialId, msg.sender);
    }

    // Replaces an issuer's credential with a newly issued credential.
    function replaceCredential(
        bytes32 oldCredentialId,
        bytes32 studentReference,
        bytes32 documentHash,
        string calldata credentialType
    ) external onlyCredentialIssuer(oldCredentialId) returns (bytes32) {
        bytes32 newCredentialId = credentialRegistry.replaceCredential(
            oldCredentialId,
            studentReference,
            documentHash,
            credentialType,
            msg.sender
        );

        emit CredentialReplaced(oldCredentialId, newCredentialId, msg.sender);
        return newCredentialId;
    }

    // Grants a verifier permission to read protected metadata for a credential.
    function grantAccess(bytes32 credentialId, address verifier) external {
        require(verifier != address(0), "Invalid verifier address");
        require(
            credentialRegistry.getCredentialStatus(credentialId) !=
                CredentialRegistry.CredentialStatus.Unknown,
            "Credential not found"
        );
        require(
            credentialRegistry.getHolder(credentialId) == msg.sender,
            "Only credential holder"
        );

        credentialAccess[credentialId][verifier] = true;

        emit AccessGranted(credentialId, msg.sender, verifier);
    }

    // Removes a verifier's metadata access for a credential.
    function revokeAccess(bytes32 credentialId, address verifier) external {
        require(verifier != address(0), "Invalid verifier address");
        require(
            credentialRegistry.getCredentialStatus(credentialId) !=
                CredentialRegistry.CredentialStatus.Unknown,
            "Credential not found"
        );
        require(
            credentialRegistry.getHolder(credentialId) == msg.sender,
            "Only credential holder"
        );
        require(credentialAccess[credentialId][verifier], "Access not granted");

        credentialAccess[credentialId][verifier] = false;

        emit AccessRevoked(credentialId, msg.sender, verifier);
    }

    // Checks whether a verifier currently has holder-granted access.
    function hasAccess(
        bytes32 credentialId,
        address verifier
    ) external view returns (bool) {
        return credentialAccess[credentialId][verifier];
    }

    // Internal helper for emitting verification audit events.
    function logVerification(
        bytes32 credentialId
    ) internal returns (bool successful) {
        require(
            credentialRegistry.getCredentialStatus(credentialId) !=
                CredentialRegistry.CredentialStatus.Unknown,
            "Credential not found"
        );

        successful =
            credentialRegistry.getCredentialStatus(credentialId) ==
            CredentialRegistry.CredentialStatus.Active;

        emit VerificationLogged(
            credentialId,
            msg.sender,
            successful,
            block.timestamp
        );
    }
}

// Public-facing contract used by verifiers to check credentials.
// It combines registry data, institution approval status, and holder-granted
// access checks so verifiers do not need to call each lower-level contract directly.
contract VerificationContract {
    CredentialRegistry public immutable credentialRegistry;
    InstitutionRegistry public immutable institutionRegistry;
    LifecycleAndAccessControl public immutable lifecycleAndAccessControl;

    constructor(
        address credentialRegistryAddress,
        address institutionRegistryAddress,
        address lifecycleAndAccessControlAddress
    ) {
        require(
            credentialRegistryAddress != address(0),
            "Invalid credential registry"
        );
        require(
            institutionRegistryAddress != address(0),
            "Invalid institution registry"
        );
        require(
            lifecycleAndAccessControlAddress != address(0),
            "Invalid lifecycle contract"
        );

        credentialRegistry = CredentialRegistry(credentialRegistryAddress);
        institutionRegistry = InstitutionRegistry(institutionRegistryAddress);
        lifecycleAndAccessControl = LifecycleAndAccessControl(
            lifecycleAndAccessControlAddress
        );
    }

    event VerificationLogged(
        bytes32 indexed credentialId,
        address indexed verifier,
        bool successful,
        uint256 verifiedAt
    );

    event DocumentHashChecked(
        bytes32 indexed credentialId,
        address indexed verifier,
        bool matches,
        uint256 checkedAt
    );

    // Checks that a credential is active and its issuer is still approved.
    function verifyCredential(
        bytes32 credentialId
    ) external returns (bool successful) {
        address issuer = credentialRegistry.getIssuer(credentialId);

        successful =
            credentialRegistry.getCredentialStatus(credentialId) ==
            CredentialRegistry.CredentialStatus.Active &&
            institutionRegistry.verifyInstitution(issuer);

        emit VerificationLogged(
            credentialId,
            msg.sender,
            successful,
            block.timestamp
        );
    }

    // Compares a supplied document hash against the hash stored on-chain.
    function compareDocumentHash(
        bytes32 credentialId,
        bytes32 suppliedDocumentHash
    ) external returns (bool matches) {
        require(suppliedDocumentHash != bytes32(0), "Document hash required");

        matches =
            credentialRegistry.getDocumentHash(credentialId) ==
            suppliedDocumentHash;

        emit DocumentHashChecked(
            credentialId,
            msg.sender,
            matches,
            block.timestamp
        );
    }

    // Exposes the registry status through the verification contract.
    function getCredentialStatus(
        bytes32 credentialId
    ) external view returns (CredentialRegistry.CredentialStatus) {
        return credentialRegistry.getCredentialStatus(credentialId);
    }

    // Returns full metadata only when the holder has granted the caller access.
    function getCredentialMetadata(
        bytes32 credentialId
    ) external view returns (CredentialRegistry.Credential memory) {
        require(
            lifecycleAndAccessControl.hasAccess(credentialId, msg.sender),
            "Access not granted"
        );

        return credentialRegistry.getCredential(credentialId);
    }
}
