import './globals.css';

export const metadata = {
  title: 'HTGT Room Ideas',
  description: 'Furniture room vignette generator for Higgsfield',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-stone-50 text-stone-900 min-h-screen">
        {children}
      </body>
    </html>
  );
}
