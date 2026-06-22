import { useState } from "react";
import { graphql } from "../api/api.js";

/**
 * Reidentificar.jsx
 * ----------------------------------------------------------------------------
 * Modal de reidentificação. Exige MOTIVO obrigatório (LGPD: registro de
 * finalidade) e mostra a PII em uma caixa destacada — com aviso de que a
 * operação foi auditada (passo 8).
 *
 * Importante: o `solicitante` NÃO é enviado pelo cliente. Ele vem do JWT
 * via header X-User-Login injetado pelo Gateway. Aqui só mandamos o motivo.
 */

const MUTATION = `
  mutation Reid($pseudonimo: ID!, $solicitante: String!, $motivo: String!) {
    reidentifyPatient(
      pseudonimo: $pseudonimo
      solicitante: $solicitante
      motivo: $motivo
    ) {
      pseudonimo nome cpf leito idadeAprox sexo
    }
  }
`;

export default function Reidentificar({ paciente, onFechar }) {
  const [motivo, setMotivo] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [resultado, setResultado] = useState(null);

  async function reidentificar(e) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      // Nota sobre `solicitante`: o backend prefere o header X-User-Login
      // injetado pelo Gateway. O valor que mandamos aqui é fallback caso
      // a chamada seja feita sem Gateway — situação que NÃO acontece em
      // produção. Para o schema GraphQL é obrigatório, então mandamos algo.
      const data = await graphql(MUTATION, {
        pseudonimo: paciente.pseudonimo,
        solicitante: "dashboard", // será sobrescrito pelo Gateway
        motivo: motivo.trim(),
      });
      setResultado(data.reidentifyPatient);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onFechar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Reidentificar paciente</h3>
        <p style={{ fontSize: 13, color: "#5b6b7b", margin: 0 }}>
          Leito <strong>{paciente.leito}</strong> · {paciente.pseudonimo}
        </p>

        <div className="aviso">
          Esta operação será registrada em <strong>log imutável de auditoria</strong> (LGPD Art. 37).
          Informe o motivo clínico do acesso à identidade do paciente.
        </div>

        {!resultado ? (
          <form onSubmit={reidentificar}>
            {erro && <div className="erro">{erro}</div>}
            <div className="form-group">
              <label>Motivo do acesso</label>
              <input
                type="text"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="ex: prescricao medicamento, evolucao clinica"
                minLength={5}
                required
                autoFocus
              />
            </div>
            <div className="botoes">
              <button type="button" className="btn-secundario" onClick={onFechar}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={carregando}>
                {carregando ? "Verificando..." : "Reidentificar"}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="pii-box">
              <div><strong>Nome:</strong> {resultado.nome}</div>
              <div><strong>CPF:</strong> {resultado.cpf}</div>
              <div><strong>Leito:</strong> {resultado.leito}</div>
              {resultado.idadeAprox && <div><strong>Idade aprox.:</strong> {resultado.idadeAprox} anos</div>}
              {resultado.sexo && <div><strong>Sexo:</strong> {resultado.sexo}</div>}
            </div>
            <div className="botoes">
              <button type="button" className="primary" onClick={onFechar}>
                Fechar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
