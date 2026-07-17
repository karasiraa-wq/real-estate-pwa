import { useEffect, useState } from 'react'
import AdminPage from './components/AdminPage.jsx'
import FeedPage from './components/FeedPage.jsx'
import ListingDetail from './components/ListingDetail.jsx'
import ListingForm from './components/ListingForm.jsx'

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
  let tagline
  if (isAdmin) {
    page = <AdminPage />
    tagline = 'Listing review'
  } else if (path === '/submit') {
    page = <ListingForm />
    tagline = 'List your property or land — it goes live once verified'
  } else if (detail) {
    page = <ListingDetail id={detail[1]} navigate={navigate} />
    tagline = 'Every listing is checked before it goes live'
  } else if (path === '/land') {
    // RentUg Land: same app and brand, its own themed section (key remounts
    // the feed so switching tabs never flashes the other category's cards).
    page = <FeedPage key="land" navigate={navigate} category="land" />
    tagline = 'Plots and land for sale — reviewed before they go live'
  } else {
    page = <FeedPage key="rental" navigate={navigate} />
    tagline = 'Every listing is checked before it goes live'
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <a
            className="brand-home"
            href="/"
            aria-label="RentUg home"
            onClick={(e) => {
              e.preventDefault()
              navigate('/')
            }}
          >
            <img src="/icon-192.png" alt="" className="brand-icon" />
            <div>
              <h1>RentUg</h1>
              <p className="tagline">{tagline}</p>
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
      <main>{page}</main>
    </div>
  )
}
