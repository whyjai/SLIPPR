import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Dashboard',
  description: 'SLIPPR AI council picks, sharp/public view, and bet tools.',
};

export default function DashboardPage() {
  redirect('/?tab=dashboard');
}
