import { createOrganizationAction } from "./actions";

export function CreateOrganizationForm() {
  return (
    <form action={createOrganizationAction} className="stack" style={{ marginTop: 20 }}>
      <label style={{ display: "grid", gap: 8 }}>
        <span>Organization name</span>
        <input
          name="name"
          type="text"
          minLength={2}
          maxLength={100}
          placeholder="e.g. Kisii University"
          required
          style={{ width: "100%", padding: "12px 14px", border: "1px solid #d1d5db", borderRadius: 8 }}
        />
      </label>
      <label style={{ display: "grid", gap: 8 }}>
        <span>Organization URL</span>
        <input
          name="slug"
          type="text"
          minLength={3}
          maxLength={48}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder="e.g. kisii-university"
          required
          style={{ width: "100%", padding: "12px 14px", border: "1px solid #d1d5db", borderRadius: 8 }}
        />
        <small className="muted">Use lowercase letters, numbers and hyphens. This must be unique.</small>
      </label>
      <div>
        <button className="button" type="submit">Create organization</button>
      </div>
    </form>
  );
}
