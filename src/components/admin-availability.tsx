import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  CalendarDays,
  Download,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getAdminAvailability,
  type AdminAvailabilityRow,
} from "@/lib/availability.functions";

function displayDate(value: string) {
  const [year, month, day] = value.split("-");

  return `${day}/${month}/${year}`;
}

function csvCell(value: string) {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

export function AdminAvailability() {
  const getAvailability = useServerFn(getAdminAvailability);

  const [rows, setRows] = useState<AdminAvailabilityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const result = await getAvailability();

      setRows(result.rows);
    } catch (error) {
      console.error(
        "Failed to load admin availability:",
        error,
      );

      toast.error("Could not load availability.");
    } finally {
      setLoading(false);
    }
  }, [getAvailability]);

  useEffect(() => {
    void load();
  }, [load]);

  const unavailablePeople = useMemo(
    () => new Set(rows.map((row) => row.userId)).size,
    [rows],
  );

  const unavailableDates = useMemo(
    () => new Set(rows.map((row) => row.date)).size,
    [rows],
  );

  function downloadSpreadsheet() {
    const header = [
      "User ID",
      "Name",
      "Email",
      "Team",
      "Unavailable Date",
      "Recorded At",
    ];

    const lines = [
      header.map(csvCell).join(","),
      ...rows.map((row) =>
        [
          row.userId,
          row.name,
          row.email,
          row.team,
          row.date,
          row.createdAt,
        ]
          .map(csvCell)
          .join(","),
      ),
    ];

    const blob = new Blob(
      ["\uFEFF", lines.join("\n")],
      {
        type: "text/csv;charset=utf-8",
      },
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `POM_Availability_${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;

    document.body.appendChild(link);

    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  }

  return (
    <Card className="surface-card overflow-hidden">
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CalendarDays className="size-5 text-primary" />
              Availability
            </CardTitle>

            <p className="mt-1 text-sm text-muted-foreground">
              All unavailable dates submitted by POM members.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw
                className={`size-4 ${
                  loading ? "animate-spin" : ""
                }`}
              />
              Refresh
            </Button>

            <Button
              type="button"
              size="sm"
              disabled={rows.length === 0}
              onClick={downloadSpreadsheet}
            >
              <Download className="size-4" />
              Download for Sheets
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 md:px-0">
        {!loading && rows.length > 0 && (
          <div className="grid grid-cols-3 gap-3 px-0 md:px-6">
            <div className="rounded-2xl bg-muted/60 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Entries
              </p>

              <p className="mt-1 text-xl font-semibold">
                {rows.length}
              </p>
            </div>

            <div className="rounded-2xl bg-muted/60 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                People
              </p>

              <p className="mt-1 text-xl font-semibold">
                {unavailablePeople}
              </p>
            </div>

            <div className="rounded-2xl bg-muted/60 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Dates
              </p>

              <p className="mt-1 text-xl font-semibold">
                {unavailableDates}
              </p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="grid min-h-48 place-items-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <CalendarDays className="mx-auto size-8 text-muted-foreground" />

            <p className="mt-3 text-sm font-medium">
              Everyone is available
            </p>

            <p className="mt-1 text-xs text-muted-foreground">
              No unavailable dates have been submitted yet.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {rows.map((row) => (
                <div
                  key={`${row.userId}-${row.date}`}
                  className="rounded-2xl border border-border p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {row.name}
                      </p>

                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {row.email}
                      </p>
                    </div>

                    <Badge
                      variant="secondary"
                      className="shrink-0"
                    >
                      {displayDate(row.date)}
                    </Badge>
                  </div>

                  <p className="mt-3 text-xs text-muted-foreground">
                    {row.team}
                  </p>
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Email</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={`${row.userId}-${row.date}`}
                    >
                      <TableCell className="whitespace-nowrap font-medium">
                        {displayDate(row.date)}
                      </TableCell>

                      <TableCell>{row.name}</TableCell>

                      <TableCell className="text-muted-foreground">
                        {row.team}
                      </TableCell>

                      <TableCell className="text-muted-foreground">
                        {row.email}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}