import AdminPage from './components/AdminPage.jsx'
import ListingForm from './components/ListingForm.jsx'

export default function App() {
  // MVP routing: two pages, no router library (CLAUDE.md Rule 5).
  const isAdmin = window.location.pathname.startsWith('/admin')
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <img src="/icon-192.png" alt="" className="brand-icon" />
          <div>
            <h1>RentUg</h1>
            <p className="tagline">
              {isAdmin ? 'Listing review' : 'Every listing is checked before it goes live'}
            </p>
          </div>
        </div>
      </header>
      <main>{isAdmin ? <AdminPage /> : <ListingForm />}</main>
    </div>
  )
}
