import React, { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, getAuth, User } from "firebase/auth";
import { app } from "../../../DB/firebase"; // 👈 asegúrate de apuntar correctamente a tu config
import { loginWithGoogle, logout } from "../../../DB/fireauth"; // 👈 tus funciones
import { addDocument, getDogsByOwner } from "../../../DB/firestoreService"; // helper para escribir en Firestore

const API_BASE: string = (import.meta as any).env?.VITE_API_URL ?? '';

const buildApiUrl = (path: string) => {
  if (!API_BASE) return path;
  const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
  return `${base}${path}`;
};

// Crear el contexto
const AuthContext = createContext<{
  user: User | null;
  isAuthenticated: boolean;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  publishDog: (dogData: any) => Promise<string | void>;
  publishedDogs: any[];
}>( {
  user: null,
  isAuthenticated: false,
  setUser: () => {},
  loginWithGoogle: async () => {},
  logout: async () => {},
  publishDog: async () => {},
  publishedDogs: []
});

// Hook para usar el contexto más fácilmente
export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [publishedDogs, setPublishedDogs] = useState<any[]>([]);
  const auth = getAuth(app);

  // Detectar cambios en el estado de autenticación
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        console.log("Usuario autenticado:", currentUser.displayName);
        setUser(currentUser);
      } else {
        setUser(null);
      }
    });

    return () => unsubscribe();
  }, [auth]);

  // Funciones conectadas a Firebase
  const handleLogin = async () => {
    try {
      const loggedUser = await loginWithGoogle();
      setUser(loggedUser);
    } catch (error) {
      console.error("Error al iniciar sesión:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setUser(null);
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
    }
  };

  // Publicar un perro en Firestore usando el helper compartido en /DB
  const publishDog = async (dogData: any): Promise<string | void> => {
    try {
      // Attach owner info (email, uid, displayName) and creation timestamp
      const ownerEmail = user?.email ?? null;
      //const ownerId = user?.uid ?? null;
      //const ownerName = (user as any)?.displayName ?? null;

      const dogWithOwner = {
        ...dogData,
        ownerEmail
      };

      // Primero intentamos publicarlo a través del backend para que se dispare el flujo completo
      if (API_BASE) {
        try {
          const token = await user?.getIdToken?.();
          const response = await fetch(buildApiUrl('/api/dogs'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify(dogWithOwner)
          });

          if (!response.ok) {
            const message = await response.text();
            throw new Error(message || `Backend respondió ${response.status}`);
          }

          const payload = await response.json();
          const createdDog = payload?.dog;
          if (createdDog?.id) {
            setPublishedDogs(prev => {
              const withoutDuplicate = prev.filter(item => item.id !== createdDog.id);
              return [...withoutDuplicate, createdDog];
            });
            return createdDog.id as string;
          }
        } catch (err) {
          console.error('Error publicando perro mediante backend:', err);
          // Si falla, continuamos con el fallback a Firestore directo.
        }
      }

      // Fallback directo a Firestore si no hay backend o hubo un error
      const id = await addDocument("Perro", dogWithOwner);
      console.log("Perro publicado con id (Firestore directo):", id);
      setPublishedDogs(prev => [...prev, { ...dogWithOwner, id }]);
      return id;
    } catch (error) {
      console.error("Error publicando perro:", error);
    }
  };

  // Load published dogs for the authenticated user
  useEffect(() => {
    let mounted = true;
    const loadPublished = async () => {
      if (!user) {
        if (mounted) setPublishedDogs([]);
        return;
      }
      try {
        const email = user.email ?? undefined;
        if (!email) {
          if (mounted) setPublishedDogs([]);
          return;
        }

        if (API_BASE) {
          try {
            const url = buildApiUrl(`/api/dogs?ownerEmail=${encodeURIComponent(email)}`);
            const resp = await fetch(url);
            if (resp.ok) {
              const data = await resp.json();
              if (!mounted) return;
              setPublishedDogs(Array.isArray(data?.dogs) ? data.dogs : []);
              return;
            }
            console.warn('Fallo cargando publicaciones desde backend:', resp.status);
          } catch (err) {
            console.error('Error solicitando publicaciones al backend:', err);
          }
        }

        const list = await getDogsByOwner(email);
        if (!mounted) return;
        setPublishedDogs(list);
      } catch (err) {
        console.error('Error loading published dogs for user:', err);
        if (mounted) setPublishedDogs([]);
      }
    };
    loadPublished();
    return () => { mounted = false; };
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        setUser,
        loginWithGoogle: handleLogin,
        logout: handleLogout,
        publishDog,
        publishedDogs
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
