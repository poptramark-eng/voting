"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function createOrganizationAction(formData: FormData) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    redirect("/auth/login?returnTo=/dashboard");
  }

  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();

  if (
    name.length < 2 ||
    name.length > 100 ||
    slug.length < 3 ||
    slug.length > 48 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
  ) {
    redirect("/dashboard?setup=invalid");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("create_organization", {
    org_name: name,
    org_slug: slug,
  });

  if (error) {
    // 23505 is PostgreSQL's unique-constraint violation (usually duplicate slug).
    console.error("Organization creation failed:", error);
    redirect(error.code === "23505" ? "/dashboard?setup=exists" : "/dashboard?setup=failed");
  }

  revalidatePath("/dashboard");
  redirect("/dashboard?setup=created");
}
