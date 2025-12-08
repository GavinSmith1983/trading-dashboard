import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';

// Cognito configuration
const COGNITO_CONFIG = {
  UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || 'eu-west-2_t4tJsxt3z',
  ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID || '7c3s7gtdskn3nhpbivmsapgk74',
};

const userPool = new CognitoUserPool(COGNITO_CONFIG);

export interface User {
  email: string;
  name: string;
  groups: string[];
  sub: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ requiresNewPassword: boolean; tempUser?: CognitoUser }>;
  completeNewPassword: (tempUser: CognitoUser, newPassword: string) => Promise<void>;
  logout: () => void;
  getIdToken: () => Promise<string | null>;
  hasRole: (role: string) => boolean;
  isAdmin: boolean;
  isEditor: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const parseToken = useCallback((idToken: string): User | null => {
    try {
      const payload = JSON.parse(atob(idToken.split('.')[1]));
      return {
        email: payload.email || '',
        name: `${payload.given_name || ''} ${payload.family_name || ''}`.trim() || payload.email,
        groups: payload['cognito:groups'] || [],
        sub: payload.sub,
      };
    } catch {
      return null;
    }
  }, []);

  const checkSession = useCallback(() => {
    const cognitoUser = userPool.getCurrentUser();
    if (cognitoUser) {
      cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session || !session.isValid()) {
          setUser(null);
          setIsLoading(false);
          return;
        }
        const idToken = session.getIdToken().getJwtToken();
        const parsedUser = parseToken(idToken);
        setUser(parsedUser);
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }
  }, [parseToken]);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const login = useCallback(async (email: string, password: string): Promise<{ requiresNewPassword: boolean; tempUser?: CognitoUser }> => {
    return new Promise((resolve, reject) => {
      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: userPool,
      });

      const authDetails = new AuthenticationDetails({
        Username: email,
        Password: password,
      });

      cognitoUser.authenticateUser(authDetails, {
        onSuccess: (session: CognitoUserSession) => {
          const idToken = session.getIdToken().getJwtToken();
          const parsedUser = parseToken(idToken);
          setUser(parsedUser);
          resolve({ requiresNewPassword: false });
        },
        onFailure: (err: Error) => {
          reject(err);
        },
        newPasswordRequired: () => {
          resolve({ requiresNewPassword: true, tempUser: cognitoUser });
        },
      });
    });
  }, [parseToken]);

  const completeNewPassword = useCallback(async (tempUser: CognitoUser, newPassword: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      tempUser.completeNewPasswordChallenge(newPassword, {}, {
        onSuccess: (session: CognitoUserSession) => {
          const idToken = session.getIdToken().getJwtToken();
          const parsedUser = parseToken(idToken);
          setUser(parsedUser);
          resolve();
        },
        onFailure: (err: Error) => {
          reject(err);
        },
      });
    });
  }, [parseToken]);

  const logout = useCallback(() => {
    const cognitoUser = userPool.getCurrentUser();
    if (cognitoUser) {
      cognitoUser.signOut();
    }
    setUser(null);
  }, []);

  const getIdToken = useCallback(async (): Promise<string | null> => {
    return new Promise((resolve) => {
      const cognitoUser = userPool.getCurrentUser();
      if (!cognitoUser) {
        resolve(null);
        return;
      }

      cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session || !session.isValid()) {
          resolve(null);
          return;
        }
        resolve(session.getIdToken().getJwtToken());
      });
    });
  }, []);

  const hasRole = useCallback((role: string): boolean => {
    if (!user) return false;
    return user.groups.includes(role);
  }, [user]);

  const isAdmin = user?.groups.includes('admin') || false;
  const isEditor = isAdmin || user?.groups.includes('editor') || false;

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        completeNewPassword,
        logout,
        getIdToken,
        hasRole,
        isAdmin,
        isEditor,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
