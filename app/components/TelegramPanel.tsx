"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setWebhookAction, unlinkTelegram, createInviteLink, deleteInviteLink } from "@/app/actions/telegram";
import { IconSend } from "./icons";
import { useMessages } from "@/lib/i18n/context";

export default function TelegramPanel({
  enabled,
  deepLink,
  startToken,
  botUsername,
  hasAccount,
  canManageUsers = false,
  inviteToken: initialInviteToken = null,
}: {
  enabled: boolean;
  deepLink: string | null;
  startToken: string;
  botUsername: string | null;
  hasAccount: boolean;
  canManageUsers?: boolean;
  inviteToken?: string | null;
}) {
  const router = useRouter();
  const m = useMessages();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string>("");
  const [inviteToken, setInviteToken] = useState<string | null>(initialInviteToken);
  const [copied, setCopied] = useState(false);

  function doWebhook() {
    start(async () => {
      const res = await setWebhookAction();
      setMsg(res?.ok ? res.message ?? m.telegram.webhookDone : res?.error ?? m.common.error);
      router.refresh();
    });
  }

  function doUnlink() {
    if (!confirm(m.telegram.disconnectConfirm)) return;
    start(async () => {
      await unlinkTelegram();
      router.refresh();
    });
  }

  function doCreateInvite() {
    start(async () => {
      const res = await createInviteLink();
      if (res.ok && res.token) {
        setInviteToken(res.token);
      }
    });
  }

  function doDeleteInvite() {
    if (!confirm(m.telegram.revokeConfirm)) return;
    start(async () => {
      await deleteInviteLink();
      setInviteToken(null);
    });
  }

  function copyInviteLink() {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const inviteLink = inviteToken && botUsername
    ? `https://t.me/${botUsername}?start=${inviteToken}`
    : null;

  return (
    <div className="flex flex-col gap-3">
      {!enabled && (
        <p className="rounded-xl bg-st-cancelled/10 px-4 py-3 text-sm text-st-cancelled">
          {m.telegram.notConfiguredDesc}
        </p>
      )}

      {enabled && !hasAccount && (
        <div className="card p-5">
          <h2 className="mb-1 text-base font-bold">{m.telegram.connectHeading}</h2>
          <p className="mb-3 text-sm text-ink-soft">
            {m.telegram.connectDesc}
          </p>
          {deepLink ? (
            <a
              href={deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="tap inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-5 font-semibold text-white hover:bg-brand-strong"
            >
              <IconSend className="size-4" /> {m.telegram.openBot} @{botUsername}
            </a>
          ) : (
            <p className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-sm">
              {m.telegram.sendToBot} <code>/start {startToken}</code>
            </p>
          )}
        </div>
      )}

      {enabled && hasAccount && (
        <button
          onClick={doUnlink}
          disabled={pending}
          className="tap h-11 rounded-xl border border-st-cancelled/40 font-medium text-st-cancelled hover:bg-st-cancelled/10"
        >
          {m.telegram.disconnect}
        </button>
      )}

      {enabled && canManageUsers && (
        <div className="card p-5">
          <h2 className="mb-1 text-base font-bold">{m.telegram.inviteHeading}</h2>
          <p className="mb-3 text-sm text-ink-soft">
            {m.telegram.inviteDesc}
          </p>
          {inviteLink ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5">
                <span className="min-w-0 flex-1 break-all text-xs font-mono text-ink-soft">{inviteLink}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={copyInviteLink}
                  disabled={pending}
                  className="tap h-10 flex-1 rounded-xl bg-brand text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
                >
                  {copied ? m.telegram.copied : m.telegram.copyLink}
                </button>
                <button
                  onClick={doCreateInvite}
                  disabled={pending}
                  className="tap h-10 rounded-xl border border-[var(--color-line)] px-4 text-sm font-medium hover:bg-[var(--color-surface-2)] disabled:opacity-60"
                  title={m.telegram.regenerateTitle}
                >
                  {m.telegram.regenerate}
                </button>
                <button
                  onClick={doDeleteInvite}
                  disabled={pending}
                  className="tap h-10 rounded-xl border border-st-cancelled/40 px-4 text-sm font-medium text-st-cancelled hover:bg-st-cancelled/10 disabled:opacity-60"
                  title={m.telegram.revokeTitle}
                >
                  {m.common.delete}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={doCreateInvite}
              disabled={pending}
              className="tap h-11 rounded-xl bg-[var(--color-surface-2)] px-4 font-medium hover:bg-brand-soft disabled:opacity-60"
            >
              {pending ? m.telegram.creating : m.telegram.createInvite}
            </button>
          )}
        </div>
      )}

      {enabled && (
        <div className="card p-5">
          <h2 className="mb-1 text-base font-bold">{m.telegram.webhookHeading}</h2>
          <p className="mb-3 text-sm text-ink-soft">
            {m.telegram.webhookDesc}
          </p>
          <button
            onClick={doWebhook}
            disabled={pending}
            className="tap h-11 rounded-xl bg-[var(--color-surface-2)] px-4 font-medium hover:bg-brand-soft disabled:opacity-60"
          >
            {pending ? m.telegram.webhookSetting : m.telegram.webhookSet}
          </button>
          {msg && <p className="mt-2 break-all text-xs text-ink-soft">{msg}</p>}
        </div>
      )}
    </div>
  );
}
