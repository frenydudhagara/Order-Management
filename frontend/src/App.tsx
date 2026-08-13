/** Routes and layout. */

import { Link, Route, Routes } from 'react-router-dom';

import { CartProvider } from './cart/CartContext';
import { EmptyState } from './components/Feedback';
import { Header } from './components/Header';
import { CheckoutPage } from './pages/CheckoutPage';
import { MenuPage } from './pages/MenuPage';
import { OrderTrackingPage } from './pages/OrderTrackingPage';
import { OrdersPage } from './pages/OrdersPage';

export function App() {
  return (
    <CartProvider>
      <div className="flex min-h-screen flex-col">
        {/* First tab stop, so keyboard users can jump past the nav. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-lg"
        >
          Skip to content
        </a>

        <Header />

        <main id="main" className="flex-1">
          <Routes>
            <Route path="/" element={<MenuPage />} />
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/:orderId" element={<OrderTrackingPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>

        <footer className="border-t border-stone-200 py-6 text-center text-xs text-stone-500">
          Forkful · a demo order management feature
        </footer>
      </div>
    </CartProvider>
  );
}

function NotFoundPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <EmptyState
        title="Page not found"
        message="That link does not lead anywhere."
        action={
          <Link to="/" className="btn-primary">
            Back to the menu
          </Link>
        }
      />
    </div>
  );
}
