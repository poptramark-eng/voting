# ADR 0003: Separate voter eligibility from anonymous ballot casting

- Status: Proposed
- Date: 2026-11-24

## Context

The platform now supports a finalized, versioned voter register. The next stage is to authenticate eligible voters, issue voting credentials, accept ballots and prevent duplicate voting.

The platform must not create a direct relationship between a voter's identity and their ballot choices. A normal authenticated session, JWT, voter ID, email, phone number or register-entry UUID must never be used as the ballot identifier.

A simple random bearer token stored against a voter record is not sufficient: the issuer could later correlate the token with a ballot. Separating tables in one database also does not protect against a privileged database operator correlating timestamps, request logs or shared identifiers.

Public elections remain disabled. This proposal is an architecture direction for a limited organizational-voting release, not a claim that the system is suitable for legally binding public elections.

## Decision

Adopt a three-plane design. Do not implement cryptographic issuance or ballot casting until the protocol, maintained implementation library, key custody and threat model pass the acceptance gates below.

### 1. Identity and eligibility plane

- Authenticate the voter independently of the voter-register identifier. A register ID or external reference is a lookup key, never an authentication secret.
- Verify a voter through an approved proofing method, such as a one-time challenge delivered to a verified contact channel or an audited offline verification process. A voter without a verified channel must not be silently admitted using only their register number.
- Check eligibility against the current finalized snapshot for the process.
- Record issuance eligibility and audit evidence in an identity-side issuance ledger. It may reference the internal voter-register entry and snapshot, but it must not store the unblinded credential serial or a value that can be matched to a submitted credential.
- Enforce at most one credential issuance per eligible snapshot entry and process, subject to an explicitly audited recovery/reissue procedure.

### 2. Anonymous credential plane

- Evaluate an established blind-signature credential protocol. RFC 9474 RSA Blind Signatures is a candidate, not yet an accepted implementation choice.
- A credential message should be domain-separated and bind at least the process identifier, finalized snapshot version, credential expiry and a cryptographically random 256-bit serial.
- The voter blinds the message before the issuer signs it. The issuer verifies eligibility and signs only the blinded message. The voter unblinds the signature locally.
- The identity-side ledger may retain the blinded request digest, issuance state, process, snapshot, voter reference, proofing result and issuer audit metadata. It must not retain the unblinded serial or final credential.
- The ballot service verifies the final credential using the process public key. It stores only a one-way token-serial digest for replay prevention; it must not receive the voter's identity or Auth0 subject.
- Use a maintained, independently reviewed implementation with published test vectors. Do not hand-roll RSA blinding, signature encoding, nonce generation, constant-time comparisons or cryptographic verification.

### 3. Ballot and tally plane

- Ballots are encrypted to a process-specific election public key before persistence. The database must not store plaintext selections.
- The ballot ledger may store the process, encrypted ballot, token-serial digest, protocol/key version and the minimum evidence needed for integrity verification. It must not contain `app_users.id`, `voter_register_entry_id`, voter IDs, emails, phone numbers or Auth0 subjects.
- Enforce one successful cast per credential using a unique constraint on the process and token-serial digest. Credential verification, spend recording and encrypted-ballot insertion must be atomic and idempotent.
- Keep ballot storage and identity issuance behind separate database roles and service boundaries. Do not expose a join path between the identity ledger and ballot ledger.
- Tallying is a separate workflow. Use an established verifiable tally protocol and threshold decryption by independent trustees; do not decrypt ballots with a single application-server key.
- Record aggregate issuance, cast and rejection counts without recording voter identity alongside ballot choices.

## Initial release constraints

1. Keep `vote_change_policy = DISABLED`. Re-voting or ballot replacement requires a separate protocol decision; do not implement replacement by allowing a spent token to be reused.
2. Keep public elections disabled.
3. Do not issue credentials until the register snapshot is finalized and its approval state is current.
4. Do not treat a successful login as proof of eligibility. Eligibility and identity proofing are separate checks.
5. Do not log credentials, blinded or unblinded token material, ballot plaintext, selections, or voter PII in ballot-service logs.
6. Use process-specific key identifiers and protocol versions so rotation and verification remain possible.
7. If identity and ballot services share the same database or operational logs, document that this does not provide protection against a privileged platform operator correlating timing metadata.

## Alternatives considered

| Option | Decision | Reason |
|---|---|---|
| Store voter ID or Auth0 subject on each ballot | Rejected | Creates a direct identity-to-choice relationship. |
| Generate a random token and store its hash beside the voter row | Rejected | The issuer can correlate the token with a ballot after casting. |
| Use an Auth0 JWT as the ballot credential | Rejected | The subject and token issuance metadata identify the voter. |
| Store random bearer tokens in a separate table in the same database | Rejected as the anonymity design | Table separation alone does not prevent privileged joins or timing correlation. |
| Blind-signature credentials | Candidate | Can make the issuer cryptographically unable to link an issued blinded credential to its later unblinded presentation, if correctly implemented. |
| Full end-to-end verifiable election protocol | Required for higher assurance | Needs protocol selection, independent trustees, public verification and external review before public-election use. |

## Security and privacy requirements

- **Eligibility integrity:** only a voter in the current finalized snapshot can obtain a credential.
- **Credential uniqueness:** issuance is limited by the finalized snapshot and recovery policy; a credential is spendable once.
- **Unlinkability:** the issuer must not learn the final credential serial; the ballot service must not receive identity attributes.
- **Ballot secrecy:** ballot choices remain encrypted until an authorized threshold tally.
- **Replay resistance:** a unique token digest prevents duplicate casts, with atomic transaction semantics.
- **Metadata minimization:** no identity fields in the ballot schema; minimize timestamps, IP addresses, user agents and correlation identifiers.
- **Key custody:** signing and tally private keys must not live in source control, ordinary application environment variables or a single application-server process.
- **Auditability:** maintain separate identity-side and ballot-side audit trails. Do not place a shared voter/ballot correlation identifier in both.
- **Recovery:** credential reissue, lost-device handling and disputed eligibility require audited procedures that do not expose ballot choices.

## Required architecture review and acceptance gates

No credential or ballot schema migration should be merged until these questions are resolved:

1. Select and review a maintained RFC 9474-compatible library or another established anonymous-credential protocol. Verify supported variants, key sizes, encoding, randomness, side-channel resistance, test vectors and maintenance status.
2. Define the adversary model: organization owner, platform administrator, database administrator, compromised application server, network observer, colluding trustees and malicious voter.
3. Decide whether the first organizational release accepts operator-level timing correlation risk. If not, isolate the ballot box in a separate project/service operated with separate access and logs.
4. Select the voter proofing method for email/phone holders and for voters without verified contact channels.
5. Define process key generation, trustee quorum, backup, rotation, revocation and destruction ceremonies.
6. Select an established encrypted-ballot and verifiable-tally protocol. Define independent verification and recount behavior.
7. Define privacy retention and deletion rules for identity issuance records, finalized snapshots, credentials and encrypted ballots.
8. Add adversarial tests for credential forgery, cross-process replay, duplicate casts, race conditions, key-version mismatch, revoked eligibility, credential expiry, reissue and timing/log leakage.
9. Obtain independent cryptographic and election-security review before enabling public elections.

## Consequences

- The current finalized voter snapshot becomes the authoritative eligibility input, not a ballot identifier.
- Credential issuance and ballot casting become separate workflows with separate authorization and data models.
- A blind-signature protocol can reduce cryptographic linkability but does not, by itself, eliminate timing, network or operator-level correlation.
- This design adds operational complexity: separate keys, independent trust boundaries, careful logging and explicit recovery procedures.
- Public-election support remains out of scope until jurisdictional, legal, cryptographic and operational reviews are complete.

## Follow-up

- Produce a threat model and protocol comparison before writing credential tables or APIs.
- Review available RFC 9474 implementations and test vectors; do not choose a package based only on popularity.
- Define the first-release voter proofing and recovery process.
- Design the ballot encryption and threshold-tally protocol with independent trustees.
- Keep ballot casting disabled until all acceptance gates for the intended assurance tier are met.


## Initial implementation feasibility review — 2026-11-24

A first source-level screen was performed using the upstream GitHub repositories. This is not a security audit and does not select a production dependency.

| Candidate | Evidence found | Blocking concerns | Current disposition |
|---|---|---|---|
| Cloudflare `@cloudflare/blindrsa-ts` 0.4.6 | Apache-2.0; implements the four RFC 9474 RSABSSA variants; repository tests include RFC Appendix A vectors. | Declares Node.js `>=24` while this app currently targets Node 22. The implementation exports JWK private-key parameters and requires extractable `CryptoKey` objects; its software signing path uses SJCL big-integer operations. The `supportsRSARAW` optimization still calls the key-extraction path. No independent audit report was found in the reviewed repository. | Not suitable as a direct dependency for the current Node 22 app or a non-exportable HSM key. Revisit only after a separate signer design and independent review. |
| Cloudflare CIRCL Go `blindsign/blindrsa` | Upstream source implements RFC 9474 variants and includes explicit guidance preferring randomized variants in malicious-signer settings. | Its signer accepts a Go `*rsa.PrivateKey`; an HSM-backed `crypto.Signer` integration is not provided by the reviewed API. | Candidate for an isolated Go signer only if key custody is solved; not selected. |
| `jedisct1/rust-blind-rsa-signatures` 0.19.0 | MIT-licensed; repository describes RFC 9474 support and exposes SHA-384 randomized variants. | The reviewed API holds an in-process software secret key. HSM integration is not provided by the reviewed API. Dependencies and side-channel posture still require a full audit. | Candidate for an isolated signer prototype, not selected. |
| Bouncy Castle Java RFC 9474 classes | Upstream Java source includes RSABSSA client/server implementations and uses an RSA-blinded engine for the server operation. | The reviewed lightweight server accepts `RSAKeyParameters` containing private key material; HSM/PKCS#11 integration is not demonstrated by this class. | Candidate for further research, not selected. |

### Additional protocol issue: lost or reissued credentials

A blind-signed one-use token cannot be safely reissued just because a voter says the token was lost. If the old token still exists, both the old and replacement token could be spent. The ballot box cannot deduplicate by voter identity without reintroducing a link to the voter.

Therefore, do not implement credential reissue or recovery by simply issuing a second blind token. A first-release policy must either:
- prohibit reissue and explicitly handle a lost credential as an unresolved support case; or
- adopt a reviewed anonymous-credential/nullifier or revocation protocol that proves one eligible person can produce only one accepted ballot per process without exposing their identity.

This is a protocol decision, not an ordinary account-recovery feature.

### Review conclusion

No reviewed implementation currently meets all of the platform's immediate constraints: Node 22 compatibility, RFC 9474 test-vector support, no export of long-term private key material, independently reviewed constant-time signing behavior and a credible HSM/key-custody path. Keep the candidate list open. Do not vendor, fork or hand-roll blind RSA as a shortcut.
