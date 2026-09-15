chrome.runtime.sendMessage({ kind: "status" }).then((answer) => {
  document.querySelector("#status").textContent = answer?.status ?? "Indisponível";
  const toggle = document.querySelector("#toggle");
  toggle.disabled = !answer || !["Coleta ativa", "Coleta pausada"].includes(answer.status);
  toggle.textContent = answer?.enabled ? "Pausar coleta" : "Ativar coleta";
  toggle.onclick = async () => {
    toggle.disabled = true;
    const response = await chrome.runtime.sendMessage({
      kind: "set-enabled", enabled: !answer.enabled,
    }).catch(() => null);
    document.querySelector("#status").textContent = response?.ok
      ? answer.enabled ? "Coleta pausada" : "Coleta ativa"
      : "Não foi possível alterar a coleta";
    toggle.disabled = !response?.ok;
    if (response?.ok) {
      answer.enabled = !answer.enabled;
      toggle.textContent = answer.enabled ? "Pausar coleta" : "Ativar coleta";
    }
  };
  document.querySelector("#pending").textContent = `Envios pendentes: ${answer?.pending ?? "?"}`;
  document.querySelector("#version").textContent = answer?.buildId ? `Build: ${answer.buildId}` : "";
  const preview = document.querySelector("#preview");
  const previewButton = document.querySelector("#preview-button");
  const bet365Button = document.querySelector("#preview-bet365");
  previewButton.disabled = Boolean(answer?.enabled || answer?.preview?.status === "running");
  bet365Button.disabled = previewButton.disabled;
  const startPreview = async (provider) => {
    previewButton.disabled = true;
    bet365Button.disabled = true;
    const response = await chrome.runtime.sendMessage({ kind: "preview", provider }).catch(() => null);
    preview.textContent = response?.ok
      ? "Teste em andamento. Reabra este popup em alguns minutos."
      : "Teste indisponível agora.";
    if (!response?.ok) {
      previewButton.disabled = false;
      bet365Button.disabled = false;
    }
  };
  previewButton.onclick = () => startPreview(undefined);
  bet365Button.onclick = () => startPreview("bet365");
  if (answer?.preview?.status === "running")
    preview.textContent = "Teste em andamento. Reabra este popup em alguns minutos.";
  else if (answer?.preview?.status === "complete")
    preview.textContent = answer.preview.results.map((item) =>
      `${item.provider}: ${item.status}; eventos=${item.events ?? "-"}; mercados detalhe=${item.detailMarkets ?? "-"}`
    ).join("\n");
  else if (answer?.preview?.status === "failed")
    preview.textContent = "Teste falhou antes da coleta.";
  const tbody = document.querySelector("#providers");
  for (const provider of ["bet365", "betano", "superbet", "blaze", "estrelabet"]) {
    const state = answer?.providers?.[provider] ?? {};
    const row = document.createElement("tr");
    for (const value of [
      provider,
      String(state.events ?? "-"),
      state.lastSuccessAt ? new Date(state.lastSuccessAt).toLocaleTimeString("pt-BR") : "-",
      state.error ? `Erro: ${state.error}` : state.lastSuccessAt ? "OK" : "Aguardando",
    ]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    tbody.append(row);
  }
});
