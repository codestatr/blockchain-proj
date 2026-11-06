import { redirect } from "next/navigation";
import Dashboard from "./dashboard-client";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <Dashboard user={user} />;
}
