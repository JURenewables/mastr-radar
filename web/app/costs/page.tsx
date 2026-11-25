import { redirect } from "next/navigation";

// /costs has two pages; onshore wind first.
export default function CostsIndex() {
  redirect("/costs/wind");
}
