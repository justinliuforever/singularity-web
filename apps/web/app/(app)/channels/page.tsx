import { permanentRedirect } from "next/navigation";

export default function ChannelsRedirect() {
  permanentRedirect("/accounts");
}
