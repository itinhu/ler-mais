# LER+ — armazenamento no Google Drive pessoal

## Visão geral
- O login continua no Firebase Authentication; os vínculos, metadados e avaliações ficam no Firestore.
- O áudio é enviado ao servidor Vercel autenticado e transferido pelo servidor ao Google Drive via OAuth 2.0, sem conceder acesso direto do Drive a pais/professores.
- Na primeira gravação o sistema cria a pasta privada `LER+ - Gravações` na conta Google autorizada. Arquivos recebem identificadores aleatórios e **não são compartilhados publicamente**.
- O professor pode ouvir, informar palavras lidas, erros e observações, e salvar PCPM/precisão. A transcrição por IA permanece desativada.
- Limites: 60 segundos, 2,5 MB, 15 gravações por aluno e usuário ao dia (limite lógico, não transacional).

## Configurar Google Cloud / OAuth
1. Acesse https://console.cloud.google.com/ e crie ou selecione um projeto Google Cloud.
2. Em **APIs e serviços → Biblioteca**, habilite **Google Drive API**.
3. Em **Google Auth Platform / Tela de consentimento OAuth**, configure um aplicativo externo. Enquanto estiver em teste, adicione o endereço da sua conta Google como usuário de teste.
4. Crie **Cliente OAuth 2.0** do tipo **Aplicativo da Web**. Adicione como URI de redirecionamento autorizado `https://developers.google.com/oauthplayground`.
5. Abra https://developers.google.com/oauthplayground/ → engrenagem → **Use your own OAuth credentials**. Preencha o Client ID e Client Secret **somente no Google OAuth Playground**, nunca no GitHub ou neste chat.
6. Na etapa 1, autorize exclusivamente o escopo `https://www.googleapis.com/auth/drive.file` usando sua conta Google pessoal.
7. Na etapa 2, troque o código por tokens e copie o **Refresh token**. Não o publique nem compartilhe no chat.
8. Na Vercel, em **Project → Settings → Environment Variables**, configure para **Production**:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REFRESH_TOKEN`
9. Faça redeploy de produção quando as variáveis estiverem salvas.

**Importante:** aplicativos OAuth externos no estado **Testing** podem emitir refresh tokens que expiram em **7 dias**. Antes do uso contínuo, configure a publicação/consentimento de forma adequada e verifique as exigências de verificação do Google. Se a autorização for revogada ou expirar, o envio e a reprodução param até renovar a autorização.

## Proteção de dados
- Não use dados reais de crianças antes de revisar consentimento/base legal, retenção, exclusão, controles de acesso e contratos/termos de processamento (LGPD).
- O Drive é pessoal, portanto avalie o risco de misturar dados escolares e particulares. Para produção escolar, prefira uma conta institucional gerenciada.
- O proprietário do Drive tem acesso direto aos áudios; os demais só acessam pelo aplicativo mediante vínculo verificado no Firebase.
- O aplicativo ainda precisa de rotinas de exclusão de arquivos e limpeza de uploads órfãos e de testes de integração.
- O projeto usa `drive.file` para limitar acesso da aplicação aos arquivos que ela cria, não ao Drive inteiro.
- Não altere permissões dos arquivos para "qualquer pessoa com o link".

## Limitações
- O upload de áudio é enviado via JSON/base64 à função Vercel; arquivos acima de 2,5 MB são recusados. Não use para vídeos.
- Arquivos gravados anteriormente no Firebase Storage não são migrados automaticamente.
- O plano pessoal Google inclui armazenamento gratuito compartilhado com outros serviços, sujeito aos limites atuais da conta.
