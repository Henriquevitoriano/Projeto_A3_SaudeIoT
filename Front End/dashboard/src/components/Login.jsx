import { useState } from "react";
import { login } from "../api/api.js";

/**
 * Login.jsx
 * ----------------------------------------------------------------------------
 * Tela única de autenticação. Chama o /auth/login do Gateway.
 *
 * Observação de UX: o backend retorna a MESMA mensagem para "usuário não
 * existe" e "senha errada" (anti-enumeração que implementamos no Passo 7).
 * O frontend respeita isso — não inventa mensagens diferentes.
 */
export default function Login({ onLogar }) {
  const [loginValue, setLoginValue] = useState("");
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  async function submeter(e) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      const usuario = await login(loginValue, senha);
      onLogar(usuario);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submeter}>
        <h2>UTI Monitor</h2>
        <p className="subtitle">Sistema de monitoramento de pacientes</p>

        {erro && <div className="erro">{erro}</div>}

        <div className="form-group">
          <label htmlFor="login">Usuário</label>
          <input
            id="login"
            type="text"
            value={loginValue}
            onChange={(e) => setLoginValue(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
        </div>

        <div className="form-group">
          <label htmlFor="senha">Senha</label>
          <input
            id="senha"
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        <button className="primary" type="submit" disabled={carregando}>
          {carregando ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
