/**
 * Foundational voting-domain contracts.
 *
 * These are application-level concepts, not a finalized persistence schema.
 * Keep identity/eligibility records separate from secret ballot payloads.
 */

export type VotingCategory =
  | "GENERAL_POLL"
  | "CONTEST"
  | "ORGANIZATIONAL_ELECTION"
  | "PUBLIC_ELECTION";

export type AssuranceTier = "STANDARD" | "ENHANCED" | "HIGH" | "CRITICAL";

export type ProcessStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "SCHEDULED"
  | "OPEN"
  | "SUSPENDED"
  | "CLOSED"
  | "TERMINATED"
  | "UNDER_REVIEW"
  | "CERTIFIED";

export type BallotFormat =
  | "SINGLE_CHOICE"
  | "MULTIPLE_CHOICE"
  | "RANKED_CHOICE"
  | "YES_NO"
  | "APPROVAL"
  | "SCORED";

export type VoteChangePolicy =
  | { kind: "DISABLED" }
  | { kind: "UNLIMITED" }
  | { kind: "LIMITED"; maxReplacements: number };

export type ResultsDisclosurePolicy =
  | { kind: "LIVE" }
  | { kind: "AFTER_CLOSURE" }
  | { kind: "SCHEDULED"; publishAt: string }
  | { kind: "CUSTOM"; rulesetId: string };

export type EligibilityMode =
  | "OPEN_LINK"
  | "INVITATION_ONLY"
  | "MANAGED_REGISTER"
  | "VERIFIED_MEMBERSHIP"
  | "COMBINED";

export interface VotingEvent {
  id: string;
  organizationId: string;
  title: string;
  category: VotingCategory;
  assuranceTier: AssuranceTier;
  status: ProcessStatus;
}

export interface VotingProcess {
  id: string;
  eventId: string;
  title: string;
  status: ProcessStatus;
  ballotFormat: BallotFormat;
  eligibilityMode: EligibilityMode;
  voteChangePolicy: VoteChangePolicy;
  resultsDisclosure: ResultsDisclosurePolicy;
  opensAt: string;
  closesAt: string;
}

/**
 * Deliberately excludes voter identity and eligibility identifiers.
 * Ballot payloads must be protected by a separately reviewed cryptographic
 * protocol before any production implementation.
 */
export interface EncryptedBallotEnvelope {
  ballotId: string;
  processId: string;
  ciphertext: string;
  protocolVersion: string;
  acceptedAt: string;
}

/**
 * Eligibility credentials and ballot records must not share a joinable
 * voter identifier. This receipt is a verification handle, not a ballot choice.
 */
export interface BallotAcceptanceReceipt {
  receiptId: string;
  processId: string;
  inclusionCommitment: string;
  acceptedAt: string;
  verificationMethod: string;
}
