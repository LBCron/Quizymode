import { createContext } from "react";
/** Session identity for media grants; no process-wide blob cache survives a sign-in change. */
export const MediaIdentityContext = createContext("guest");
