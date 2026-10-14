"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { UserProfile } from "@/lib/account/types";
import { updateMe, changePassword } from "@/lib/account/actions";
import { SignInMethods } from "@/components/dashboard/sign-in-methods";

const ROLE_LABELS: Record<UserProfile["role"], string> = {
  admin: "Admin",
  staff: "Staff",
  user: "User",
  guest: "Guest",
};

// The label-over-value list of the dataset page: a hairline between rows.
const DETAIL_ROW = "flex flex-col gap-0.5 border-t border-border py-3 first:border-t-0 first:pt-0";
const DETAIL_LABEL = "text-xs text-muted-foreground";
const DETAIL_VALUE = "text-sm font-medium text-foreground";

export function AccountCard({
  profile,
  cilogonEnabled = false,
}: {
  profile: UserProfile;
  /** Whether CILogon sign-in is configured on this server; the profile page
   *  decides on the server, so the card never offers what cannot work. */
  cilogonEnabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.name);
  const [organization, setOrganization] = useState(profile.organization ?? "");
  const [profileError, setProfileError] = useState("");

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordDone, setPasswordDone] = useState(false);

  function handleSaveProfile() {
    setProfileError("");
    startTransition(async () => {
      const result = await updateMe({
        name: name.trim(),
        organization: organization.trim() || null,
      });
      if (!result.ok) {
        const message = result.message ?? "Failed to update profile.";
        setProfileError(message);
        toast.error(message);
        return;
      }
      setEditing(false);
      toast.success("Profile updated.");
      router.refresh();
    });
  }

  function handleCancelProfile() {
    setName(profile.name);
    setOrganization(profile.organization ?? "");
    setProfileError("");
    setEditing(false);
  }

  function handleChangePassword() {
    setPasswordError("");
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("Password must be at least 8 characters.");
      return;
    }
    startTransition(async () => {
      const result = await changePassword(currentPassword, newPassword);
      if (!result.ok) {
        const message = result.message ?? "Failed to change password.";
        setPasswordError(message);
        toast.error(message);
        return;
      }
      toast.success("Password changed. Signing you out to sign back in...");
      setPasswordDone(true);
    });
  }

  if (passwordDone) {
    // The backend revoked every other session and reissued tokens for this
    // one, but the frontend doesn't splice fresh tokens into an
    // already-issued NextAuth session — signing back in with the new
    // password is simpler and just as secure.
    signOut({ callbackUrl: "/auth/signin?passwordChanged=1" });
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Password changed. Signing you out to sign back in...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {editing ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="account-name">Name</Label>
              <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-organization">Organization</Label>
              <Input
                id="account-organization"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="Purdue University"
              />
            </div>
            {profileError && <p className="text-xs text-destructive">{profileError}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveProfile} disabled={pending || !name.trim()}>
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={handleCancelProfile} disabled={pending}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <dl>
              <div className={DETAIL_ROW}>
                <dt className={DETAIL_LABEL}>Name</dt>
                <dd className={DETAIL_VALUE}>{profile.name}</dd>
              </div>
              <div className={DETAIL_ROW}>
                <dt className={DETAIL_LABEL}>Email</dt>
                <dd className={`${DETAIL_VALUE} flex flex-wrap items-center gap-2`}>
                  <span className="[overflow-wrap:anywhere]">{profile.email}</span>
                  <Badge variant={profile.email_verified ? "secondary" : "outline"}>
                    {profile.email_verified ? "Verified" : "Unverified"}
                  </Badge>
                </dd>
              </div>
              <div className={DETAIL_ROW}>
                <dt className={DETAIL_LABEL}>Organization</dt>
                <dd className={DETAIL_VALUE}>{profile.organization ?? "—"}</dd>
              </div>
              <div className={DETAIL_ROW}>
                <dt className={DETAIL_LABEL}>Role</dt>
                <dd className={DETAIL_VALUE}>{ROLE_LABELS[profile.role]}</dd>
              </div>
              {profile.created_at && (
                <div className={DETAIL_ROW}>
                  <dt className={DETAIL_LABEL}>Member since</dt>
                  <dd className={DETAIL_VALUE} suppressHydrationWarning>
                    {new Date(profile.created_at).toLocaleDateString()}
                  </dd>
                </div>
              )}
            </dl>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit profile
            </Button>
          </div>
        )}

        <div className="border-t border-border pt-5">
          <SignInMethods profile={profile} cilogonEnabled={cilogonEnabled} />
        </div>

        {/* An account with no password has none to change: its card above
            links to setting one. */}
        {profile.has_password && (
          <div className="border-t border-border pt-5">
            {showPasswordForm ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="current-password">Current password</Label>
                  <Input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-new-password">Confirm new password</Label>
                  <Input
                    id="confirm-new-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                {passwordError && <p className="text-xs text-destructive">{passwordError}</p>}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleChangePassword}
                    disabled={pending || !currentPassword || !newPassword}
                  >
                    Change password
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowPasswordForm(false);
                      setCurrentPassword("");
                      setNewPassword("");
                      setConfirmPassword("");
                      setPasswordError("");
                    }}
                    disabled={pending}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setShowPasswordForm(true)}>
                Change password
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
