import { permanentRedirect } from "next/navigation";

// Default project slug == account slug.
export default async function ProjectPoetRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const s = encodeURIComponent(slug);
  permanentRedirect(`/accounts/${s}/projects/${s}/poet`);
}
