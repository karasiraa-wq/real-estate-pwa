import ListingForm from './components/ListingForm.jsx'

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <img src="/icon-192.png" alt="" className="brand-icon" />
          <div>
            <h1>RentUg</h1>
            <p className="tagline">Every listing is checked before it goes live</p>
          </div>
        </div>
      </header>
      <main>
        <ListingForm />
      </main>
    </div>
  )
}
