import { useState, useEffect } from "react";
import { obterUsuario, limparSessao } from "./api/api.js";
import Login from "./components/Login.jsx";
import Pacientes from "./components/Pacientes.jsx";
import Alertas from "./components/Alertas.jsx";

/**
 * App.jsx
 * ----------------------------------------------------------------------------
 * Componente raiz. Decide se mostra a tela de login ou o painel principal,
 * baseado na presença de um usuário em sessão.
 *
 * Padrão simples: o estado `usuario` vive aqui. Login altera, logout limpa.
 * Sem React Router porque temos só 2 "telas" (logado/deslogado).
 */
export default function App() {
  // Lê sessão na primeira renderização — se a aba foi recarregada com sessão
  // ainda válida, o usuário já entra logado.
  const [usuario, setUsuario] = useState(() => obterUsuario());

  // Escuta evento de "sessão expirada" disparado pela camada api quando
  // pega um 401 (token venceu). Daí limpamos o state do App e voltamos
  // para o login automaticamente.
  useEffect(() => {
    const onExpirou = () => setUsuario(null);
    window.addEventListener("sessao-expirada", onExpirou);
    return () => window.removeEventListener("sessao-expirada", onExpirou);
  }, []);

  function aoLogar(user) {
    setUsuario(user);
  }

  function deslogar() {
    limparSessao();
    setUsuario(null);
  }

  if (!usuario) {
    return <Login onLogar={aoLogar} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>UTI Monitor</h1>
        <div>
          <span className="user">
            {usuario.nome} · <strong>{usuario.role}</strong>
          </span>
          <button onClick={deslogar}>Sair</button>
        </div>
      </header>
      <main>
        <div className="layout-2col">
          <Pacientes usuario={usuario} />
          <Alertas />
        </div>
      </main>
    </div>
  );
}
