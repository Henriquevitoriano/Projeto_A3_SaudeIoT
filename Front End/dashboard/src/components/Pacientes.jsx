import { useState, useEffect } from "react";
import { graphql } from "../api/api.js";
import Reidentificar from "./Reidentificar.jsx";

/**
 * Pacientes.jsx
 * ----------------------------------------------------------------------------
 * Lista de pacientes da UTI com seus scores NEWS2. Atualiza a cada 5 segundos.
 *
 * Faz UMA query GraphQL que traz tudo de uma vez:
 *   patients { pseudonimo, leito, news2 { scoreTotal, risco, ... } }
 *
 * RBAC no frontend: o botão "Reidentificar" só aparece para `role: "medico"`.
 * Importante: isso é APENAS UX — a barreira de segurança real está no
 * Gateway. Se um enfermeiro hackear o DOM e tentar chamar a mutation, o
 * Gateway retorna 403. Esta é a definição de "defesa em profundidade":
 * mais de uma camada bloqueando a mesma operação.
 */

const QUERY = `
  query {
    patients {
      pseudonimo
      leito
      idadeAprox
      sexo
      news2 {
        scoreTotal
        risco
        maiorIndividual
        sinaisAvaliados
        detalhes { tipo valor pontos }
      }
    }
  }
`;

const INTERVALO_REFRESH_MS = 5000;

export default function Pacientes({ usuario }) {
  const [pacientes, setPacientes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [reidAlvo, setReidAlvo] = useState(null); // paciente do modal

  // Carrega e agenda refresh
  useEffect(() => {
    let ativo = true;

    async function carregar() {
      try {
        const data = await graphql(QUERY);
        if (!ativo) return;
        setPacientes(data.patients);
        setErro(null);
      } catch (e) {
        if (!ativo) return;
        setErro(e.message);
        if (e.message === "sessão expirada") {
          window.dispatchEvent(new Event("sessao-expirada"));
        }
      } finally {
        if (ativo) setCarregando(false);
      }
    }

    carregar();
    const id = setInterval(carregar, INTERVALO_REFRESH_MS);

    // Cleanup: evita memory leak quando o componente sai da tela
    return () => { ativo = false; clearInterval(id); };
  }, []);

  if (carregando) return <p>Carregando pacientes...</p>;
  if (erro) return <div className="erro">Erro: {erro}</div>;
  if (pacientes.length === 0) return <p className="vazio">Nenhum paciente cadastrado.</p>;

  const podeReidentificar = usuario.role === "medico";

  return (
    <div>
      <h3 className="section-title">Pacientes em monitoramento ({pacientes.length})</h3>
      <div className="pacientes-grid">
        {pacientes.map((p) => (
          <PacienteCard
            key={p.pseudonimo}
            paciente={p}
            podeReidentificar={podeReidentificar}
            onReidentificar={() => setReidAlvo(p)}
          />
        ))}
      </div>

      {reidAlvo && (
        <Reidentificar
          paciente={reidAlvo}
          onFechar={() => setReidAlvo(null)}
        />
      )}
    </div>
  );
}

function PacienteCard({ paciente, podeReidentificar, onReidentificar }) {
  const risco = paciente.news2?.risco || "indeterminado";
  const score = paciente.news2?.scoreTotal ?? "—";
  const sinaisCriticos = (paciente.news2?.detalhes || [])
    .filter((d) => d.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, 3);

  return (
    <div className={`paciente-card risco-${risco}`}>
      <div className="card-header">
        <div>
          <div className="card-leito">{paciente.leito || "—"}</div>
          <div className="card-pseudo">{paciente.pseudonimo}</div>
        </div>
        <span className={`badge ${risco}`}>{risco}</span>
      </div>

      <div className={`score-box ${risco}`}>
        NEWS2: <span className="num">{score}</span>
        <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 8 }}>
          ({paciente.news2?.sinaisAvaliados ?? 0}/5 sinais)
        </span>
      </div>

      {sinaisCriticos.length > 0 && (
        <div className="detalhes-mini">
          {sinaisCriticos.map((d) => (
            <span key={d.tipo}>
              {d.tipo}: <strong>{d.valor}</strong> ({d.pontos}pt)
            </span>
          ))}
        </div>
      )}

      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>
        {paciente.idadeAprox && `${paciente.idadeAprox}a`}
        {paciente.sexo && ` · ${paciente.sexo}`}
      </div>

      {podeReidentificar && (
        <button className="btn-reid" onClick={onReidentificar}>
          Reidentificar paciente →
        </button>
      )}
    </div>
  );
}
