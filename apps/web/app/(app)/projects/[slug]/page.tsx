import { permanentRedirect } from "next/navigation";

export default async function ProjectHubRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  permanentRedirect(`/accounts/${encodeURIComponent(slug)}`);
}
