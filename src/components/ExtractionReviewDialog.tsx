import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type LineItem = {
  date: string | null;
  description: string;
  amount: number;
  confidence?: number;
};

type ExtractionData = {
  vendor: string | null;
  date: string | null;
  line_items: LineItem[];
  tax_total: number;
  grand_total: number;
  computed_total?: number;
  validation_error?: boolean;
  field_confidence?: {
    vendor?: number;
    date?: number;
    tax_total?: number;
    grand_total?: number;
  };
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  extraction: ExtractionData | null;
  currency: string;
};

const CONFIDENCE_THRESHOLD = 0.75;

function isLowConfidence(value?: number) {
  return typeof value === "number" && value < CONFIDENCE_THRESHOLD;
}

function formatConfidence(value?: number) {
  if (typeof value !== "number") return "n/a";
  return `${Math.round(value * 100)}%`;
}

export function ExtractionReviewDialog({ open, onOpenChange, imageUrl, extraction, currency }: Props) {
  if (!extraction) return null;

  const lowConfidence = {
    vendor: isLowConfidence(extraction.field_confidence?.vendor),
    date: isLowConfidence(extraction.field_confidence?.date),
    tax: isLowConfidence(extraction.field_confidence?.tax_total),
    grand: isLowConfidence(extraction.field_confidence?.grand_total) || !!extraction.validation_error,
  };

  const computedTotal = extraction.computed_total ?? extraction.line_items.reduce((sum, item) => sum + Number(item.amount || 0), 0) + Number(extraction.tax_total || 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[96vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Extraction Review
            {extraction.validation_error && (
              <Badge variant="secondary" className="bg-yellow-100 text-yellow-900 border border-yellow-300">
                <AlertTriangle className="h-3.5 w-3.5 mr-1" /> Validation mismatch
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-border/70">
            <CardContent className="p-3 sm:p-4">
              <div className="text-sm font-medium mb-3">Original document</div>
              <div className="rounded-lg border border-border overflow-hidden bg-secondary/30">
                <img src={imageUrl} alt="Uploaded receipt" className="w-full h-auto object-contain max-h-[65vh]" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardContent className="p-3 sm:p-4 space-y-3">
              <div className="text-sm font-medium">Extracted table</div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className={cn("rounded-md border p-2", lowConfidence.vendor && "bg-yellow-100 border-yellow-300")}>
                  <div className="text-xs text-muted-foreground">Vendor</div>
                  <div className="font-medium">{extraction.vendor || "Unknown"}</div>
                  <div className="text-[11px] text-muted-foreground">Confidence: {formatConfidence(extraction.field_confidence?.vendor)}</div>
                </div>
                <div className={cn("rounded-md border p-2", lowConfidence.date && "bg-yellow-100 border-yellow-300")}>
                  <div className="text-xs text-muted-foreground">Date</div>
                  <div className="font-medium">{extraction.date || "Unknown"}</div>
                  <div className="text-[11px] text-muted-foreground">Confidence: {formatConfidence(extraction.field_confidence?.date)}</div>
                </div>
              </div>

              <div className="rounded-md border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[110px]">Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Charge</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {extraction.line_items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground">
                          No line items extracted.
                        </TableCell>
                      </TableRow>
                    ) : (
                      extraction.line_items.map((item, idx) => (
                        <TableRow key={`${item.description}-${idx}`} className={cn(isLowConfidence(item.confidence) && "bg-yellow-100")}>
                          <TableCell className="text-xs">{item.date || "—"}</TableCell>
                          <TableCell>
                            <div className="font-medium">{item.description}</div>
                            <div className="text-[11px] text-muted-foreground">Confidence: {formatConfidence(item.confidence)}</div>
                          </TableCell>
                          <TableCell className="text-right font-mono-num">{formatMoney(Number(item.amount || 0), currency)}</TableCell>
                        </TableRow>
                      ))
                    )}
                    <TableRow className={cn(lowConfidence.tax && "bg-yellow-100")}>
                      <TableCell colSpan={2} className="font-medium">Tax total</TableCell>
                      <TableCell className="text-right font-mono-num">{formatMoney(Number(extraction.tax_total || 0), currency)}</TableCell>
                    </TableRow>
                    <TableRow className={cn(lowConfidence.grand && "bg-yellow-100")}>
                      <TableCell colSpan={2} className="font-semibold">Grand total</TableCell>
                      <TableCell className="text-right font-mono-num font-semibold">{formatMoney(Number(extraction.grand_total || 0), currency)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={2} className="text-xs text-muted-foreground">Computed line-items + tax</TableCell>
                      <TableCell className="text-right text-xs font-mono-num text-muted-foreground">{formatMoney(Number(computedTotal || 0), currency)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
