import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Client } from "@/lib/api/gen/types.gen";

// Formats in the browser's locale and time zone. That is safe because these
// rows only ever render in the browser, after the client-side fetch. If the
// list is ever prefetched on the server, the server's locale and time zone
// would produce different text and a hydration mismatch: format in an effect,
// or pass the user's locale and time zone explicitly.
const added = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function ClientsTable({
  clients,
  onEdit,
  onDelete,
}: {
  clients: Client[];
  onEdit: (client: Client) => void;
  onDelete: (client: Client) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Tax ID</TableHead>
          <TableHead className="hidden sm:table-cell">Added</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {clients.map((client) => (
          <TableRow key={client.id}>
            <TableCell className="max-w-64 whitespace-normal">
              <span className="block font-medium">{client.name}</span>
              {client.email && <span className="block text-muted-foreground">{client.email}</span>}
            </TableCell>
            <TableCell className="tabular-nums">
              {client.tax_id ?? <span className="text-muted-foreground">Not set</span>}
            </TableCell>
            <TableCell className="hidden text-muted-foreground tabular-nums sm:table-cell">
              {added.format(new Date(client.created_at))}
            </TableCell>
            <TableCell className="text-right">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Edit ${client.name}`}
                onClick={() => onEdit(client)}
              >
                Edit
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                aria-label={`Delete ${client.name}`}
                onClick={() => onDelete(client)}
              >
                Delete
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
