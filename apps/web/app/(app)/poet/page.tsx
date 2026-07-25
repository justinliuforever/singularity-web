import { permanentRedirect } from "next/navigation";

export default function PoetLandingRedirect() {
  permanentRedirect("/accounts");
}
