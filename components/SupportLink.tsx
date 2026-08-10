import Link from "next/link";
import { supportUrl } from "@/lib/support";

export default function SupportLink({
  children = "Contact support",
  className = "support-link",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  const href = supportUrl();
  const external = href.startsWith("http://") || href.startsWith("https://");
  return (
    <Link
      href={href}
      className={className}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </Link>
  );
}
