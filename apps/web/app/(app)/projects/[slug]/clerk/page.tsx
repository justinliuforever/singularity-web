import { permanentRedirect } from "next/navigation";

export default async function ProjectClerkRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  permanentRedirect(`/clerk/${encodeURIComponent(slug)}`);
}
