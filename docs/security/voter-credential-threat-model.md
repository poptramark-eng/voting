# Voter credential and anonymous ballot threat model

- Status: Working draft
- Date: 2026-11-24
- Related decision: [ADR 0003 — Separate voter eligibility from anonymous ballot casting](../architecture/adr/0003-anonymous-voter-credentials-and-ballot-separation.md)

## Scope

This document covers the future voter-proofing, anonymous credential, ballot-casting and tallying workflows. It does not authorize implementation or enable public elections. The finalized voter-register workflow is implemented separately; this threat model begins at the point where an eligible voter seeks a credential.

## Assets

| Asset | Security property |
|---|---|
| Finalized voter snapshot | Integrity, controlled access, auditability |
| Voter identity and proofing evidence | Confidentiality, purpose limitation, retention control |
| Credential issuance ledger | Eligibility integrity; no link to the final unblinded credential |
| Blind-signature private key | Confidentiality, integrity, controlled use and rotation |
| Anonymous credential | Unforgeability, process binding, expiry, one-time use |
| Spent-token/nullifier set | Replay prevention without voter identity |
| Encrypted ballot | Secrecy, integrity, verifiability |
| Tally/decryption key shares | Confidentiality, quorum enforcement, auditability |
| Audit evidence | Integrity and accountability without recording ballot choices |
| Service logs and metadata | Minimized correlation and access-controlled retention |

## Adversaries and trust assumptions

1. **Malicious voter:** may share credentials, attempt replay, submit malformed ballots, race duplicate requests or exploit recovery.
2. **Malicious organization manager:** may attempt to add an ineligible voter, manipulate eligibility, request excessive PII or issue credentials outside the finalized snapshot.
3. **Compromised identity/issuer service:** may attempt to mint extra credentials, retain correlation material or expose identity data.
4. **Compromised ballot service:** may attempt to accept duplicate/forged credentials, alter ballots or log identifying metadata.
5. **Privileged database/platform operator:** may query tables, correlate timestamps, inspect logs or collude across services.
6. **Network observer:** may correlate issuance and ballot submission by IP, timing, TLS endpoint or traffic volume.
7. **Colluding tally trustees:** may attempt to decrypt ballots outside the authorized quorum or infer individual choices.
8. **Compromised voter device:** may steal credentials, alter selections before encryption or reveal choices.

The initial single-platform deployment does not protect against every privileged-operator or network-correlation threat. Any release claiming stronger anonymity must separate operational control, storage and logging between the identity issuer and ballot box.

## Security goals

- Only voters included in the current finalized snapshot can obtain a credential.
- No voter receives more than the permitted credential count for a process.
- The issuer cannot link the final unblinded credential to the issuance record under the selected protocol's security assumptions.
- The ballot service does not receive voter identity, voter-register IDs, Auth0 subjects or identity-side issuance IDs.
- A credential can be spent at most once, including under concurrent requests and retries.
- Ballot choices remain encrypted until an authorized tally quorum acts.
- Ballots cannot be silently altered, removed or substituted after acceptance.
- Independent observers can verify the tally evidence without learning voter identities or individual choices.
- Logs and audit events do not create a shared identity-to-ballot correlation key.

## Threat analysis and controls

| Threat | Required controls | Residual risk |
|---|---|---|
| Ineligible voter receives a credential | Read only from the current finalized snapshot; server-side eligibility check; no client-supplied voter status; issuance cap per snapshot entry; audit every issuance | A malicious organization owner may manipulate the register before finalization; governance review and audit remain necessary. |
| Manager adds or changes voters after finalization | Immutable snapshot; audited reopening; new version and approvals before issuance | A compromised database owner can bypass application controls; production database administration must be controlled. |
| Issuer links a voter to a presented credential | Blind-signature protocol; store only blinded request/response material on identity side; never store unblinded serial there | Timing, IP, browser and service logs can still correlate issuance and presentation. |
| Issuer creates extra credentials | Unique issuance constraint per eligible snapshot entry; count limits; independent issuance audit; process-specific signing key; signing audit | An issuer with signing-key control can potentially mint additional credentials unless the key is protected and signing operations are independently audited. |
| Credential is stolen or shared | Short expiry, process binding, device-safe handling, one-time spend, voter education and controlled proofing | A valid bearer credential can be transferred before use. |
| Credential is lost and reissued | Do not simply issue a second blind token. Require a reviewed revocation/nullifier protocol or cancel/restart the process under a documented governance procedure | Without a safe recovery protocol, a voter may lose the ability to vote. |
| Duplicate or concurrent ballot cast | Verify credential, insert spent-token digest and encrypted ballot atomically; unique constraint on process and token digest; idempotency keys | Database or service compromise can still bypass controls; monitor invariant violations. |
| Credential replay across elections | Domain-separated message binds process ID, snapshot version, expiry and key version; verify all fields server-side | Key/version configuration errors can still create cross-process acceptance if not tested. |
| Ballot choices linked to identity | No identity columns or foreign keys in ballot schema; separate service roles and logs; no shared correlation ID; minimize timestamps and network metadata | Privileged operator or network observer may correlate traffic if services share infrastructure or logs. |
| Ballot tampering or plaintext exposure | Encrypt before persistence; authenticated encryption or a reviewed election protocol; public verification evidence; no plaintext ballot logs | Encryption alone does not prove correct tallying or prevent compromised client software. |
| Signing key compromise | Process-specific keys; HSM/PKCS#11 raw RSA support if RSABSSA is selected; quorum-controlled key ceremony; rotation and revocation; signing audit | Compromise before or during an election may require cancelling and restarting the process. |
| Tally key compromise or trustee collusion | Threshold decryption with independent trustees; separate key shares; public tally proofs; audited ceremonies | A quorum of colluding trustees may reveal ballots or bias the tally. |
| Malicious or compromised voter device | Client-side verification of process, candidate list and encrypted ballot; independent verification receipt that reveals no choice; device security guidance | A compromised endpoint can still alter the voter's intended selection before encryption. |
| DoS or ballot stuffing | Rate limits, process windows, bounded payloads, credential validation, monitoring and recoverable queues | Availability attacks cannot be completely prevented. |

## Trust boundaries

1. **Eligibility boundary:** finalized snapshot and audited identity proofing determine who may request a credential.
2. **Issuer boundary:** receives identity and blinded credential requests; never receives the final unblinded credential serial.
3. **Voter device boundary:** holds the blinding factor and final credential; may be compromised.
4. **Ballot boundary:** receives the final credential and encrypted ballot; never receives identity attributes.
5. **Tally boundary:** receives encrypted ballots and key shares; no voter identity data.
6. **Operations boundary:** service logs, monitoring, backups and database administration must be reviewed for correlation leakage.

The issuer and ballot service must not share a database join key, request ID, voter ID, token serial or common trace identifier. If a shared infrastructure operator can correlate exact request times, the anonymity claim must explicitly exclude that operator or the system must add independent operation and traffic-mixing controls.

## Required invariants

- Every accepted credential maps to a process and a current finalized snapshot version.
- An issuance record can be created only for one eligible snapshot entry and cannot be silently duplicated.
- The identity-side database contains no unblinded credential serial or token digest.
- The ballot-side database contains no voter ID, register-entry ID, app-user ID, email, phone or Auth0 subject.
- A ballot is accepted only if credential verification succeeds, the process is open, the key version is valid and the token has not already been spent.
- Spend recording and ballot persistence are one atomic operation.
- No ballot choice appears in identity-side tables, audit events or application logs.
- Tally output is reproducible from the accepted encrypted ballot set and the authorized decryption evidence.

## Adversarial test plan

Before enabling a credential or ballot endpoint, test at least:

- forged, malformed, truncated and wrong-length blinded messages and signatures;
- invalid signatures, wrong process IDs, wrong snapshot versions, expired credentials and retired key versions;
- duplicate and concurrent spends, network retries and idempotent resubmission;
- credentials issued to ineligible, rejected, revoked or stale-snapshot voters;
- issuance count limits and attempted issuance after register reopening;
- lost credential, recovery, revocation and process-restart procedures;
- database schema and logs for identity columns, shared identifiers, token material and ballot plaintext;
- timing and correlation analysis across issuer and ballot service logs;
- ballot ciphertext integrity, tally reproducibility, proof verification and trustee quorum enforcement;
- malicious client behavior, compromised issuer behavior and malicious administrator behavior.

## Release gates

- Protocol selected from an established specification and implementation.
- Independent cryptographic review completed.
- Signing and tally key custody reviewed and tested.
- Threat model updated with the actual service topology and operator trust assumptions.
- Voter proofing, lost-credential recovery and dispute procedures approved.
- Privacy retention schedule and legal review completed for the intended jurisdiction.
- Adversarial test suite passes in staging.
- Public elections remain disabled until jurisdiction-specific legal, cryptographic and operational approval is recorded.
