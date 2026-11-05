import type { PolicyAcceptanceItemRequest } from "@/api/users";

// The versions the signup form records. The server owns the current versions (CurrentPolicyVersions.cs, #222);
// these must match them, and CurrentPolicyVersionsTests fails when they drift.
export const TERMS_OF_SERVICE_POLICY_VERSION = "2026-03-29";
export const PRIVACY_POLICY_VERSION = "2026-11-05";

const POLICY_ACCEPTANCE_STORAGE_KEY = "PendingPolicyAcceptancesV1";

interface PendingPolicyAcceptancesState {
  email: string;
  acceptances: PolicyAcceptanceItemRequest[];
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const canUseStorage = (): boolean =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

export const queueSignUpPolicyAcceptances = (
  email: string,
  acceptedAtUtc: string
): void => {
  if (!canUseStorage()) {
    return;
  }

  const pendingState: PendingPolicyAcceptancesState = {
    email: normalizeEmail(email),
    acceptances: [
      {
        policyType: "TermsOfService",
        policyVersion: TERMS_OF_SERVICE_POLICY_VERSION,
        acceptedAtUtc,
      },
      {
        policyType: "PrivacyPolicy",
        policyVersion: PRIVACY_POLICY_VERSION,
        acceptedAtUtc,
      },
    ],
  };

  window.localStorage.setItem(
    POLICY_ACCEPTANCE_STORAGE_KEY,
    JSON.stringify(pendingState)
  );
};

export const getPendingPolicyAcceptancesForEmail = (
  email: string | null
): PolicyAcceptanceItemRequest[] => {
  if (!canUseStorage() || !email) {
    return [];
  }

  const raw = window.localStorage.getItem(POLICY_ACCEPTANCE_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as PendingPolicyAcceptancesState;
    if (normalizeEmail(parsed.email) !== normalizeEmail(email)) {
      return [];
    }

    if (!Array.isArray(parsed.acceptances)) {
      return [];
    }

    return parsed.acceptances.filter(
      (acceptance) =>
        typeof acceptance.policyType === "string" &&
        typeof acceptance.policyVersion === "string" &&
        typeof acceptance.acceptedAtUtc === "string"
    );
  } catch (error) {
    console.error("Failed to parse pending policy acceptances:", error);
    return [];
  }
};

export const clearPendingPolicyAcceptances = (): void => {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.removeItem(POLICY_ACCEPTANCE_STORAGE_KEY);
};
