import type { AuthRole } from "../../../../auth/authTypes";

export type UserFormState = {
  username: string;
  displayName: string;
  password: string;
  role: AuthRole;
  hasCertScanLicense: boolean;
};

export const INITIAL_USER_FORM: UserFormState = {
  username: "",
  displayName: "",
  password: "",
  role: "employee",
  hasCertScanLicense: false,
};
