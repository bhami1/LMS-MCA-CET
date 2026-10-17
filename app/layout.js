import './globals.css';
import Notice from '@/components/Notice';
import Navbar from '@/components/Navbar';

export const metadata = {
  title: 'Department Library - College of Engineering Trivandrum',
  description: 'Department Library Management System, College of Engineering Trivandrum (CET)',
  icons: {
    icon: '/images/emblem.webp',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <Notice />
        <Navbar />
        <main>{children}</main>
        <footer className="site-footer">
          <div className="footer-inner">
            <div>
              <p className="footer-brand">College of Engineering Trivandrum</p>
              <p> MCA Department Library Management System</p>
            </div>
            <div>
              <p>&copy; 2026 College of Engineering Trivandrum. All rights reserved.</p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
