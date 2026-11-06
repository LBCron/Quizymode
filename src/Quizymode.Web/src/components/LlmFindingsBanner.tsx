import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { adminLlmProvidersApi } from "@/api/adminLlmProviders";

interface LlmFindingsBannerProps {
  isAdmin: boolean;
}

/**
 * Admin-only warning (#480, AC 13): lists configured LLM models missing from the vendor's model list. It cannot be
 * dismissed; it disappears when the next audit run resolves the findings.
 */
export default function LlmFindingsBanner({ isAdmin }: LlmFindingsBannerProps) {
  const { data } = useQuery({
    queryKey: ["admin", "llm-model-findings"],
    queryFn: () => adminLlmProvidersApi.getModelFindings(),
    enabled: isAdmin,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  if (!isAdmin || !data || data.findings.length === 0) {
    return null;
  }

  return (
    <div role="alert" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <div className="mx-auto max-w-7xl">
        <p className="font-semibold">
          {data.findings.length === 1
            ? "A configured LLM model was not found in its vendor's model list."
            : "Configured LLM models were not found in their vendors' model lists."}
        </p>
        <ul className="list-disc pl-5">
          {data.findings.map((finding) => (
            <li key={finding.id}>
              {finding.vendor}: <code>{finding.model}</code>
            </li>
          ))}
        </ul>
        <Link to="/admin/ai-providers" className="font-medium underline">
          Open AI providers
        </Link>
      </div>
    </div>
  );
}
