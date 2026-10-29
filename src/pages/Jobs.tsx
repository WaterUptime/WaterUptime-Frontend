import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AuditTimeline, LifecycleStepper, useJobLabel } from "../components/job";
import { Button, Card, EmptyState, Field, Fingerprint, Icon, inputClass, PageHeader, PersonLabel, PriorityBadge, SectionTitle, StatusBadge, STATUS_LABEL, timeAgo } from "../components/ui";
import { ActionHint, useSwitchHint } from "../components/tx";
import { useDerived, useStore } from "../data/store";
import type { JobStatus, MaintenanceJob } from "../domain/types";
import { canCancel, canReassign, canSubmit, nextStep } from "../domain/workflow";

const TABS: (JobStatus | "all")[] = ["all", "Reported", "Assigned", "RepairSubmitted", "NeedsRework", "Verified", "Closed", "Cancelled"];

export function Jobs() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { chain } = useStore();
  const { jobs, person } = useDerived();
  const label = useJobLabel();
  const [query, setQuery] = useState("");
  const tab = (params.get("status") as JobStatus | null) ?? "all";

  const filtered = jobs.filter((j) => {
    if (tab !== "all" && j.status !== tab) return false;
    if (!query) return true;
    const l = label(j);
    const names = [j.reporter, j.technician, j.verifier].map((a) => (a ? person(a)?.name : "")).join(" ");
    return `job-${String(j.id).padStart(3, "0")} ${l.title} ${l.point} ${l.locality ?? ""} ${names}`.toLowerCase().includes(query.toLowerCase());
  });

  const selected = id ? chain.jobs[Number(id)] : filtered[0];

  return (
    <>
      <PageHeader title="Maintenance jobs" description="Follow each repair from fault report to verified close-out. Actions available depend on your role and the job's stage." />

      <div className="-mx-gutter mb-space-md flex gap-space-xs overflow-x-auto px-gutter pb-space-xs lg:mx-0 lg:px-0" role="tablist" aria-label="Filter by status">
        {TABS.map((t) => {
          const n = t === "all" ? jobs.length : jobs.filter((j) => j.status === t).length;
          const active = tab === t;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setParams(t === "all" ? {} : { status: t }, { replace: true })}
              className={`inline-flex items-center gap-space-xs whitespace-nowrap rounded-lg px-space-sm py-space-xs text-label-md transition-colors ${
                active ? "bg-surface-container-high text-primary" : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
              }`}
            >
              {t === "all" ? "All jobs" : STATUS_LABEL[t]}
              <span className="rounded-full bg-surface-container-highest px-space-xs text-label-sm tabular">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="relative mb-space-lg">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-on-surface-variant" />
        <input
          aria-label="Search jobs"
          className={`${inputClass} pl-9`}
          placeholder="Search by job, water point, locality or person…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-space-lg lg:grid-cols-12">
        <div className={`flex flex-col gap-space-sm lg:col-span-5 ${id ? "max-lg:hidden" : ""}`}>
          <span className="px-space-xs text-label-sm uppercase text-on-surface-variant">
            {filtered.length} job{filtered.length === 1 ? "" : "s"} · most recently updated first
          </span>
          {filtered.length === 0 ? (
            <EmptyState icon="inbox" title="No jobs here">
              Nothing matches this filter.
            </EmptyState>
          ) : (
            filtered.map((j) => <JobCard key={j.id} job={j} selected={selected?.id === j.id} onSelect={() => navigate(`/jobs/${j.id}${tab !== "all" ? `?status=${tab}` : ""}`)} />)
          )}
        </div>

        <div className={`lg:col-span-7 ${id ? "" : "max-lg:hidden"}`}>
          {id && (
            <Link to="/jobs" className="mb-space-sm inline-flex items-center gap-space-xxs text-label-md text-primary lg:hidden">
              <Icon name="arrow_back" className="text-base" /> All jobs
            </Link>
          )}
          {selected ? (
            <JobDetail job={selected} />
          ) : id ? (
            <EmptyState icon="search_off" title={`Job ${id} not found`}>
              It may not exist in this data source.
            </EmptyState>
          ) : null}
        </div>
      </div>
    </>
  );
}

function JobCard({ job, selected, onSelect }: { job: MaintenanceJob; selected: boolean; onSelect: () => void }) {
  const { person } = useDerived();
  const l = useJobLabel()(job);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`relative overflow-hidden rounded-xl p-space-md text-left shadow-sm transition-all ${selected ? "bg-surface-container shadow-md" : "bg-surface-container-low hover:bg-surface-container"}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1.5 ${selected ? "bg-primary" : "bg-surface-variant"}`} />
      <div className="flex flex-col gap-space-xs pl-space-xs">
        <div className="flex flex-wrap items-center gap-space-xs">
          <span className={`text-code-num ${selected ? "text-primary" : "text-on-surface"}`}>JOB-{String(job.id).padStart(3, "0")}</span>
          <PriorityBadge priority={l.priority} />
          <span className="ml-auto text-label-sm text-on-surface-variant">{timeAgo(job.updatedAt)}</span>
        </div>
        <span className="text-title-md text-on-surface">{l.title}</span>
        <span className="text-body-sm text-on-surface-variant">
          {l.point}
          {l.locality ? ` · ${l.locality}` : ""}
        </span>
        <div className="flex flex-wrap items-center justify-between gap-space-xs pt-space-xs">
          <StatusBadge status={job.status} />
          <span className="flex items-center gap-space-xxs text-body-sm text-on-surface-variant">
            <Icon name="engineering" className="text-sm" />
            {job.technician ? person(job.technician)?.name ?? "Unknown" : "Unassigned"}
          </span>
        </div>
      </div>
    </button>
  );
}

function JobDetail({ job }: { job: MaintenanceJob }) {
  const { chain } = useStore();
  const { person, record } = useDerived();
  const l = useJobLabel()(job);
  const fault = record(job.faultReference);

  return (
    <div className="flex flex-col gap-space-md">
      <Card className="bg-surface-container-low">
        <div className="mb-space-sm flex items-center justify-between">
          <span className="text-label-sm uppercase text-on-surface-variant">Workflow progress</span>
          <StatusBadge status={job.status} />
        </div>
        <LifecycleStepper status={job.status} />
      </Card>

      <Card className="flex flex-col gap-space-md p-space-lg max-sm:p-space-md">
        <div className="flex flex-col justify-between gap-space-sm sm:flex-row sm:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-space-xs">
              <span className="text-headline-sm text-on-surface">JOB-{String(job.id).padStart(3, "0")}</span>
              <PriorityBadge priority={l.priority} />
            </div>
            <p className="text-title-md text-primary">{l.title}</p>
            <p className="text-body-sm text-on-surface-variant">
              {l.point}
              {l.locality ? ` · ${l.locality} LGA` : ""} · reported {timeAgo(job.createdAt)}
            </p>
          </div>
        </div>

        {fault?.detail && <p className="rounded-lg bg-surface-container-lowest p-space-sm text-body-sm text-on-surface-variant">{fault.detail}</p>}

        <div className="grid grid-cols-1 gap-space-md rounded-lg bg-surface-container-low p-space-md md:grid-cols-3">
          {[
            { icon: "campaign", label: "Reporter", address: job.reporter },
            { icon: "engineering", label: "Technician", address: job.technician },
            { icon: "gavel", label: "Verifier", address: job.verifier },
          ].map((r) => (
            <div key={r.label} className="flex items-start gap-space-sm">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-high text-secondary">
                <Icon name={r.icon} />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="text-label-sm uppercase text-on-surface-variant">{r.label}</span>
                <PersonLabel person={person(r.address)} address={r.address} />
              </div>
            </div>
          ))}
        </div>

        <dl className="grid grid-cols-1 gap-space-xs text-body-sm sm:grid-cols-3">
          {[
            { label: "Fault record", hex: job.faultReference },
            { label: "Latest repair evidence", hex: job.repairReference },
            { label: "Latest verification", hex: job.verificationReference },
          ].map((f) => (
            <div key={f.label} className="flex flex-col gap-space-xxs">
              <dt className="text-label-sm uppercase text-on-surface-variant">{f.label}</dt>
              <dd>
                <Fingerprint hex={f.hex} label={f.label} />
              </dd>
            </div>
          ))}
        </dl>

        <JobActions job={job} admin={chain.admin} />
      </Card>

      <Card>
        <SectionTitle icon="history" aside={<span className="text-code-num text-on-surface-variant">{(chain.history[job.id] ?? []).length} events</span>}>
          Audit trail
        </SectionTitle>
        <AuditTimeline entries={chain.history[job.id] ?? []} />
      </Card>
    </div>
  );
}

function JobActions({ job, admin }: { job: MaintenanceJob; admin: string }) {
  const { actor, readOnly } = useStore();
  const { person } = useDerived();
  const switchHint = useSwitchHint();

  if (readOnly) {
    return (
      <Notice icon="visibility">
        Read-only testnet view. Connect Freighter to sign the actions your account is allowed to take, or use demo data to try every role.
      </Notice>
    );
  }
  if (!actor) return null;

  const isCoordinator = actor.address === admin;
  const isTech = actor.address === job.technician;
  const panels = [];

  if (isCoordinator && canReassign(job.status)) panels.push(<AssignPanel key="assign" job={job} />);
  if (isCoordinator && job.status === "Verified") panels.push(<ClosePanel key="close" job={job} />);
  if (isTech && canSubmit(job.status)) panels.push(<SubmitPanel key="submit" job={job} />);
  if (actor.address === job.verifier && job.status === "RepairSubmitted") {
    panels.push(
      <Notice key="verify" icon="gavel">
        This repair is waiting for your decision.{" "}
        <Link className="text-primary underline" to={`/verification?job=${job.id}`}>
          Open it in the verification queue
        </Link>
        .
      </Notice>,
    );
  }
  if (isCoordinator && canCancel(job.status)) panels.push(<CancelPanel key="cancel" job={job} />);

  if (panels.length === 0) {
    const next = nextStep(job);
    const who = next.actor === "coordinator" ? person(admin) : person(next.actor ?? undefined);
    return (
      <Notice icon="hourglass_top">
        {next.step
          ? `Waiting on ${who?.name ?? "the assigned person"} (${who?.title.toLowerCase() ?? "role"}). ${switchHint}`
          : "This job is finished. Its history stays on record."}
      </Notice>
    );
  }
  return <div className="flex flex-col gap-space-md border-t border-surface-variant pt-space-md">{panels}</div>;
}

function Notice({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-space-xs rounded-lg bg-surface-container-lowest p-space-sm text-body-sm text-on-surface-variant">
      <Icon name={icon} className="text-base text-secondary" />
      <span>{children}</span>
    </p>
  );
}

const OTHER = "other";
const isAccount = (a: string) => /^G[A-Z2-7]{55}$/.test(a);

/** Pick a known participant, or (testnet) paste any account address. */
function AccountSelect({ label, role, value, onChange }: { label: string; role: "technician" | "verifier"; value: string; onChange(v: string): void }) {
  const { mode } = useStore();
  const { peopleByRole } = useDerived();
  const known = peopleByRole(role);
  const [other, setOther] = useState(value !== "" && !known.some((p) => p.address === value));
  return (
    <Field label={label}>
      <select
        required
        className={inputClass}
        value={other ? OTHER : value}
        onChange={(e) => {
          const v = e.target.value;
          setOther(v === OTHER);
          onChange(v === OTHER ? "" : v);
        }}
      >
        <option value="">Choose a {role}…</option>
        {known.map((p) => (
          <option key={p.address} value={p.address}>
            {p.name}
          </option>
        ))}
        {mode === "testnet" && <option value={OTHER}>Other account address…</option>}
      </select>
      {other && (
        <input
          required
          aria-label={`${label} account address`}
          className={`${inputClass} mt-space-xs tabular`}
          placeholder="G…"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          pattern="G[A-Z2-7]{55}"
        />
      )}
    </Field>
  );
}

function AssignPanel({ job }: { job: MaintenanceJob }) {
  const { actions } = useStore();
  const [tech, setTech] = useState(job.technician ?? "");
  const [ver, setVer] = useState(job.verifier ?? "");
  const same = tech !== "" && tech === ver;
  const valid = isAccount(tech) && isAccount(ver);
  const reassign = job.status !== "Reported";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void actions.assign(job.id, tech, ver);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-space-sm">
      <h3 className="text-label-md uppercase text-on-surface">{reassign ? "Reassign personnel" : "Assign personnel"}</h3>
      <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-2">
        <AccountSelect label="Technician" role="technician" value={tech} onChange={setTech} />
        <AccountSelect label="Independent verifier" role="verifier" value={ver} onChange={setVer} />
      </div>
      {same && <p className="text-body-sm text-error">The technician and the verifier must be different people.</p>}
      <div>
        <Button type="submit" tone="primary" icon="assignment_ind" disabled={!valid || same}>
          {reassign ? "Reassign" : "Assign job"}
        </Button>
      </div>
      <ActionHint />
    </form>
  );
}

function SubmitPanel({ job }: { job: MaintenanceJob }) {
  const { actions } = useStore();
  const [summary, setSummary] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await actions.submitRepair(job.id, summary.trim(), detail.trim() || undefined);
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-space-sm">
      <h3 className="text-label-md uppercase text-on-surface">{job.status === "NeedsRework" ? "Resubmit repair evidence" : "Submit repair evidence"}</h3>
      <Field label="Work performed">
        <input required className={inputClass} placeholder="e.g. Replaced riser pipe and seals" value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <Field label="Checks and test results" hint="Photos and logs stay in the off-chain evidence store. Only a fingerprint is recorded.">
        <textarea rows={3} className={`${inputClass} resize-none`} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="e.g. 10-minute flow test, no leaks" />
      </Field>
      <div>
        <Button type="submit" tone="primary" icon="verified_user" disabled={busy || !summary.trim()}>
          Submit for verification
        </Button>
      </div>
      <ActionHint />
    </form>
  );
}

function ClosePanel({ job }: { job: MaintenanceJob }) {
  const { actions } = useStore();
  return (
    <div className="flex flex-col gap-space-sm">
      <h3 className="text-label-md uppercase text-on-surface">Close job</h3>
      <p className="text-body-sm text-on-surface-variant">The verifier approved this repair. Closing it frees the water point for future reports.</p>
      <div>
        <Button tone="primary" icon="task_alt" onClick={() => void actions.close(job.id)}>
          Close job
        </Button>
      </div>
      <ActionHint />
    </div>
  );
}

function CancelPanel({ job }: { job: MaintenanceJob }) {
  const { actions } = useStore();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <div>
        <Button tone="ghost" icon="block" onClick={() => setOpen(true)}>
          Cancel this job…
        </Button>
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void actions.cancel(job.id, reason.trim());
      }}
      className="flex flex-col gap-space-sm rounded-lg bg-surface-container-lowest p-space-sm"
    >
      <h3 className="text-label-md uppercase text-error">Cancel job</h3>
      <p className="text-body-sm text-on-surface-variant">For mistaken or duplicate reports. Cancelling is permanent; the history is kept.</p>
      <Field label="Reason">
        <input required className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate of an existing report" />
      </Field>
      <div className="flex gap-space-sm">
        <Button type="submit" tone="danger" icon="block" disabled={!reason.trim()}>
          Cancel job
        </Button>
        <Button tone="ghost" onClick={() => setOpen(false)}>
          Keep job
        </Button>
      </div>
      <ActionHint />
    </form>
  );
}

