import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { Button } from "@/components/ui/button";

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      render={<Link href={href} />}
      className="w-fit text-muted-foreground"
    >
      <ChevronLeft data-icon="inline-start" />
      返回 {label}
    </Button>
  );
}
