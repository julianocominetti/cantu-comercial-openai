import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const GITHUB_RAW = "https://raw.githubusercontent.com/julianocominetti/cantu-agent/main/data";

const cache = {};
async function getData(filename) {
  if (!cache[filename]) {
    const res = await fetch(`${GITHUB_RAW}/${filename}`);
    if (!res.ok) throw new Error(`Falha ao carregar ${filename}: ${res.status}`);
    cache[filename] = await res.text();
  }
  return cache[filename];
}

function detectarArquivos(pergunta) {
  const p = pergunta.toLowerCase();
  const arquivos = new Set();
  if (p.includes('filial') || p.includes('ranking') || p.includes('loja') || p.includes('unidade') || p.includes('resumo geral')) arquivos.add('filial.txt');
  if (p.includes('segment')) arquivos.add('segmento.txt');
  if (p.includes('categ') || p.includes('produto')) arquivos.add('categoria.txt');
  if (p.includes('client') || p.includes('top') || p.includes('churn') || p.includes('concentra')) arquivos.add('cliente.txt');
  if (p.includes('vendedor') || p.includes('representant') || p.includes('meta')) arquivos.add('vendedor.txt');
  if (p.includes('execut') || p.includes('completo') || p.includes('geral')) {
    arquivos.add('filial.txt'); arquivos.add('segmento.txt');
    arquivos.add('categoria.txt'); arquivos.add('cliente.txt');
  }
  if (arquivos.size === 0) arquivos.add('filial.txt');
  return [...arquivos];
}

const SYSTEM_PROMPT = `Você é o Executivo Comercial Cantu, assistente de análise de vendas do Grupo Cantu. Responda sempre em português, com linguagem executiva e objetiva.

ANO DOS DADOS: 2026. Sempre use 2026 nas respostas.

ESTRUTURA DOS DADOS:
1. filial.txt — CODFILIAL | FILIAL | Jan_FAT | Jan_MRG | Jan_META | ... | TOTAL_FAT | MELHOR_MES | MELHOR_MES_FAT
   "Celso Ramos / Cristal Verde" já está somado (CODFILIAL=99).
2. segmento.txt — SEGMENTO | Jan_FAT | Jan_MRG | ... | TOTAL_FAT
3. categoria.txt — CODFILIAL | CATEGORIA | CATEGORIA2 | SEGMENTO | Jan_FAT | ... | TOTAL_FAT | MARGEM_MEDIA
4. cliente.txt — CODFILIAL | CLIENTE | CODVENDEDOR | SEGMENTO | Jan_FAT | ... | TOTAL_FAT | MARGEM_MEDIA
5. vendedor.txt — CODFILIAL | CODVENDEDOR | VENDEDOR | Jan_FAT | Jan_META | ... | TOTAL_FAT | TOTAL_META

CHAVE DE CRUZAMENTO: CODFILIAL é a chave que liga todos os arquivos. Use CODFILIAL para filtrar por filial.
Para identificar a filial pelo nome: localize o CODFILIAL no filial.txt.

RANKING DE FILIAIS:
| FILIAL | Jan | Fev | Mar | Abr | TOTAL |
Ordene pelo TOTAL decrescente. SEM variação. SEM colunas extras.

ANÁLISE DE VENDEDORES — regras obrigatórias:
- Sempre filtre pelo CODFILIAL correto da filial solicitada
- NUNCA misture vendedores de filiais diferentes
- Oculte vendedores com faturamento zero no período solicitado
- Exiba: VENDEDOR | Faturamento | Meta | % Meta
- % Meta = (Faturamento / Meta * 100) — exiba como XX,X%
- Ordene pelo faturamento decrescente

ANÁLISE DE CLIENTES:
- Filtre pelo CODFILIAL da filial se especificada
- Exiba nome do CLIENTE e o VENDEDOR responsável (via CODVENDEDOR → vendedor.txt)
- Oculte clientes com faturamento zero
- Limite Top 12, ordene por TOTAL decrescente

ANÁLISE DE CATEGORIAS: Top 12, ordene por TOTAL decrescente.

Formate: Faturamento em R$ (ex: R$ 14,8M), Margem em % (ex: 25,33%).
Sempre indique o período e a filial analisada.`;

const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${ACCESS_PASSWORD}`) {
    return res.status(401).json({ error: "Acesso não autorizado" });
  }

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Mensagens inválidas" });
  }

  try {
    const historico = messages.slice(-4);
    const ultimaMensagem = historico[historico.length - 1]?.content || "";
    const arquivos = detectarArquivos(ultimaMensagem);

    const dados = await Promise.all(
      arquivos.map(async (f) => `=== ${f} ===\n${await getData(f)}`)
    );

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 4096,
      messages: [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${dados.join("\n\n")}` },
        ...historico
      ],
    });

    const text = response.choices[0]?.message?.content || "";
    res.status(200).json({ response: text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno: " + err.message });
  }
}
