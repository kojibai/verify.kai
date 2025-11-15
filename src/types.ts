export interface KaiSigKksMetadata {
  spec: string;
  specVersion: string;
  kksType: string;

  pulse: number;
  beat: number;
  stepIndex: number;
  chakraDay: string;

  userPhiKey: string;
  kaiSignature: string;
  timestamp: string;

  // Allow future extension without `any`
  [key: string]: unknown;
}

export interface VerificationResult {
  status: "ok" | "warning" | "error";
  title: string;
  message: string;
  metadata?: KaiSigKksMetadata;
}
