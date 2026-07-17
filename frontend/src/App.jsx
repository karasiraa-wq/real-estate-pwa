import { useEffect, useState } from 'react'
import AdminPage from './components/AdminPage.jsx'
import FeedPage from './components/FeedPage.jsx'
import ListingDetail from './components/ListingDetail.jsx'
import ListingForm from './components/ListingForm.jsx'
import Logo from './components/Logo.jsx'

export default function App() {
  // MVP routing: history API + one state hook, no router library (CLAUDE.md Rule 5).
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = (to) => {
    window.history.pushState(null, '', to)
    setPath(to)
    window.scrollTo(0, 0)
  }

  const detail = path.match(/^\/listing\/(\d+)$/)
  const isAdmin = path.startsWith('/admin')

  let page
  if (isAdmin) {
    page = <AdminPage />
  } else if (path === '/submit') {
    page = <ListingForm />
  } else if (detail) {
    page = <ListingDetail id={detail[1]} navigate={navigate} />
  } else if (path === '/land') {
    // RentUg Land: same app and brand, its own themed section (key remounts
    // the feed so switching tabs never flashes the other category's cards).
    page = <FeedPage key="land" navigate={navigate} category="land" />
  } else {
    page = <FeedPage key="rental" navigate={navigate} />
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <a
            className="brand-home"
            href="/"
            aria-label="RentUg home"
            onClick={(e) => {
              e.preventDefault()
              navigate('/')
            }}
          >
            <Logo size={40} className="brand-icon" />
            <div className="brand-text">
              <h1>
                Rent<span className="brand-ug">Ug</span>
              </h1>
              <p className="tagline">
                {isAdmin
                  ? 'Listing review'
                  : path === '/land'
                    ? 'Plots & land, reviewed before going live'
                    : 'Verified rentals. No brokers.'}
              </p>
            </div>
          </a>
          {!isAdmin && path !== '/submit' && (
            <a
              className="header-cta"
              href="/submit"
              onClick={(e) => {
                e.preventDefault()
                navigate('/submit')
              }}
            >
              + List property
            </a>
          )}
        </div>
      </header>
      <main className="app">{page}</main>
    </div>
  )
}
