import { permanentRedirect } from "next/navigation";

export default async function ProjectClerkVideoRedirect({
  params,
}: {
  params: Promise<{ slug: string; videoId: string }>;
}) {
  const { slug, videoId } = await params;
  permanentRedirect(`/clerk/${encodeURIComponent(slug)}/${encodeURIComponent(videoId)}`);
}
