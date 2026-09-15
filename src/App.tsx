import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'
import './App.css'
import Login from './pages/Login/Login'
import Dashboard from './pages/Dashboard/Dashboard'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = sessionStorage.getItem('isAuthenticated') === 'true'

  return isAuthenticated ? children : <Navigate to="/login" replace />
}


function App() {
  return (
    <BrowserRouter>
      <Routes>
       
        {/* Rota principal */}
        <Route path="/" element={<Navigate to="/login" replace />} />

        {/* Tela de Login */}
        <Route path="/login" element={<Login />} />

        {/* Dashboard protegido */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App
