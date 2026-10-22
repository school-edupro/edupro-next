/** Books sold (docs/design/36-library.md, "Library reports", part 4): what the API gives the screens. */
export interface SaleBook {
  no: string;
  copy: {
    id: string;
    accessionNo: string;
    title: string;
    author: string | null;
    status: string;
    price: number | null;
    library: string | null;
  } | null;
  problem: string | null;
  canSell: boolean;
}

export interface SaleOrder {
  id: string;
  saleNo: string;
  soldOn: string;
  buyer: {
    kind: 'student' | 'employee' | 'other';
    id: string | null;
    name: string;
    ref: string | null;
    mobile: string | null;
  };
  books: Array<{
    accessionNo: string;
    titleId: string;
    title: string;
    price: number;
    copyPrice: number | null;
    fromStatus: string | null;
  }>;
  total: number;
  state: 'due' | 'paid' | 'cancelled' | 'free';
  paid: number;
  due: number;
  mode: string | null;
  reference: string | null;
  note: string | null;
  soldBy: string | null;
  miscFeeId: string | null;
  receipt: { id: string; receiptNo: string | null } | null;
}

export interface SaleRow {
  id: string;
  orderId: string;
  saleNo: string;
  soldOn: string;
  buyerKind: 'student' | 'employee' | 'other';
  buyer: string;
  buyerRef: string | null;
  accessionNo: string;
  titleId: string;
  title: string;
  author: string | null;
  price: number;
  copyPrice: number | null;
  fromStatus: string | null;
  state: SaleOrder['state'];
  receiptNo: string | null;
  mode: string | null;
  soldBy: string | null;
}

export interface SalesUpload {
  id: string;
  fileName: string;
  status: 'checked' | 'applied' | 'discarded';
  by: string | null;
  at: string;
  counts: { rows: number; ok: number; errors: number; sales: number; amount: number } | null;
  sales: Array<{ id: string; saleNo: string; buyer: string; books: number; total: number }> | null;
  lines: Array<{
    row: number;
    ok: boolean;
    error: string | null;
    accessionNo: string;
    title: string | null;
    buyerKind: 'student' | 'employee' | 'other' | null;
    buyer: string | null;
    price: number | null;
    mode: string | null;
  }>;
}

export const SALE_STATE: Record<
  SaleOrder['state'],
  [string, 'warning' | 'success' | 'neutral' | 'info']
> = {
  due: ['Due at the fees counter', 'warning'],
  paid: ['Paid', 'success'],
  cancelled: ['Cancelled', 'neutral'],
  free: ['No price', 'info'],
};
export const BUYER_KIND: Record<string, string> = {
  student: 'Pupil',
  employee: 'Staff',
  other: 'Outside',
};
export const FROM_STATUS: Record<string, string> = {
  available: 'On the shelf',
  damaged: 'Damaged',
  withdrawn: 'Withdrawn',
};
export const rupees = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
