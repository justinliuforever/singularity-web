import { permanentRedirect } from "next/navigation";

export default function MuseLandingRedirect() {
  permanentRedirect("/accounts");
}
