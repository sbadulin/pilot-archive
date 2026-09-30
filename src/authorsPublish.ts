import {jsonRequest} from "./ingestionClient";
import {composeAuthorsIndex, type CreditRow} from "../functions/api/_lib/authorsIndex";

// Rebuild the public author search index in the curator's browser and publish it to Selectel.
// Functions on the free plan lack the CPU to build it for the whole archive; the browser has plenty.
export async function publishSearchIndex(): Promise<number> {
  const rows: CreditRow[] = [];
  for (let after: string | null = ""; after !== null; ) {
    const page: {rows: CreditRow[]; next: string | null} = await jsonRequest(
      `/api/admin/authors/rows?after=${encodeURIComponent(after)}`,
    );
    rows.push(...page.rows);
    after = page.next;
  }
  const index = composeAuthorsIndex(rows);
  await jsonRequest("/api/admin/authors/publish-index", {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(index),
  });
  return index.names.length;
}
