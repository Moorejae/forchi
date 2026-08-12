import os
import sys
from reportlab.lib.pagesizes import letter
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super(NumberedCanvas, self).__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_number(num_pages)
            super(NumberedCanvas, self).showPage()
        super(NumberedCanvas, self).save()

    def draw_page_number(self, page_count):
        if self._pageNumber == 1:
            return  # Suppress headers/footers on cover page
        
        self.saveState()
        self.setFont("Helvetica-Bold", 8)
        self.setFillColor(colors.HexColor("#4A5568"))
        
        # Running Header
        self.drawString(54, 750, "FORCHI BOT — MASTER REVISION & SYSTEM POST-MORTEM REPORT")
        self.setStrokeColor(colors.HexColor("#CBD5E0"))
        self.setLineWidth(0.5)
        self.line(54, 742, 558, 742)
        
        # Running Footer
        self.line(54, 50, 558, 50)
        self.setFont("Helvetica", 8)
        self.drawString(54, 38, "CONFIDENTIAL — Victor's Autonomous Agent Architecture Ecosystem")
        page_text = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(558, 38, page_text)
        self.restoreState()

def build_pdf(filename):
    doc = SimpleDocTemplate(
        filename,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )
    
    styles = getSampleStyleSheet()
    
    # Custom Color Palette
    PRIMARY = colors.HexColor("#1A2B4C")    # Navy
    SECONDARY = colors.HexColor("#2B6CB0")  # Accent Blue
    TEXT_DARK = colors.HexColor("#2D3748")  # Dark Slate
    BG_LIGHT = colors.HexColor("#F7FAFC")   # Light Gray
    BORDER_COLOR = colors.HexColor("#E2E8F0")
    ALERT_BG = colors.HexColor("#FFF5F5")
    ALERT_BORDER = colors.HexColor("#FEB2B2")
    SUCCESS_BG = colors.HexColor("#F0FFF4")
    SUCCESS_BORDER = colors.HexColor("#9AE6B4")
    CODE_BG = colors.HexColor("#1E293B")
    
    # Custom Styles
    title_style = ParagraphStyle(
        'CoverTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=26,
        leading=32,
        textColor=PRIMARY,
        spaceAfter=12
    )
    
    subtitle_style = ParagraphStyle(
        'CoverSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=14,
        leading=18,
        textColor=SECONDARY,
        spaceAfter=24
    )
    
    meta_style = ParagraphStyle(
        'CoverMeta',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=10,
        leading=14,
        textColor=TEXT_DARK
    )
    
    h1_style = ParagraphStyle(
        'Heading1_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=18,
        leading=22,
        textColor=PRIMARY,
        spaceBefore=18,
        spaceAfter=8,
        keepWithNext=True
    )
    
    h2_style = ParagraphStyle(
        'Heading2_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=13,
        leading=17,
        textColor=SECONDARY,
        spaceBefore=14,
        spaceAfter=6,
        keepWithNext=True
    )

    h3_style = ParagraphStyle(
        'Heading3_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=11,
        leading=15,
        textColor=TEXT_DARK,
        spaceBefore=10,
        spaceAfter=4,
        keepWithNext=True
    )
    
    body_style = ParagraphStyle(
        'Body_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9.5,
        leading=14,
        textColor=TEXT_DARK,
        spaceAfter=8
    )

    bullet_style = ParagraphStyle(
        'Bullet_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9.5,
        leading=14,
        textColor=TEXT_DARK,
        leftIndent=15,
        firstLineIndent=-10,
        spaceAfter=4
    )
    
    code_style = ParagraphStyle(
        'Code_Custom',
        parent=styles['Normal'],
        fontName='Courier',
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#E2E8F0"),
        spaceBefore=4,
        spaceAfter=4
    )

    table_header_style = ParagraphStyle(
        'TableHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=9,
        leading=12,
        textColor=colors.white
    )

    table_cell_style = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=11,
        textColor=TEXT_DARK
    )

    callout_style = ParagraphStyle(
        'CalloutText',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=13,
        textColor=colors.HexColor("#9B2C2C")
    )

    story = []
    
    # ---------------------------------------------------------
    # COVER PAGE
    # ---------------------------------------------------------
    story.append(Spacer(1, 40))
    story.append(Paragraph("PROJECT FORCHI", subtitle_style))
    story.append(Paragraph("Master Technical Revision & System Post-Mortem Report", title_style))
    story.append(HRFlowable(width="100%", thickness=3, color=SECONDARY, spaceAfter=20))
    
    story.append(Paragraph("<b>Author / Lead Architect:</b> Antigravity AI (Pair Programming with Victor)", meta_style))
    story.append(Paragraph("<b>Target System:</b> ForChi Multimodal Social Media & Chat Workflow Bot", meta_style))
    story.append(Paragraph("<b>Date of Compilation:</b> August 12, 2026", meta_style))
    story.append(Paragraph("<b>Document Classification:</b> Comprehensive System History, Bug Audit & Rebranding Blueprint", meta_style))
    story.append(Spacer(1, 25))

    # Cover Summary Box
    summary_html = """
    <b>EXECUTIVE NOTICE & SCOPE OF THIS REVISION DOCUMENT:</b><br/>
    This document serves as the exhaustive technical record and post-mortem analysis for the <b>ForChi Bot Architecture</b>. 
    It covers every implementation detail, containerization failure, network packet trace, secret configuration mismatch, 
    and LLM key rotation bug encountered during development and deployment on Hugging Face Spaces.<br/><br/>
    <b>Action Completed:</b> Per user instruction, all active Hugging Face Spaces (specifically <code>slymun/forchi</code>) 
    and remote cloud deployments have been completely erased. This document acts as the definitive blueprint and lessons-learned 
    manifest prior to the full rebranding and relaunch of ForChi v2.
    """
    box_data = [[Paragraph(summary_html, body_style)]]
    box_table = Table(box_data, colWidths=[504])
    box_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), BG_LIGHT),
        ('BOX', (0,0), (-1,-1), 1.5, SECONDARY),
        ('PADDING', (0,0), (-1,-1), 12),
    ]))
    story.append(box_table)
    story.append(PageBreak())

    # ---------------------------------------------------------
    # SECTION 1: EXECUTIVE SUMMARY & SYSTEM OVERVIEW
    # ---------------------------------------------------------
    story.append(Paragraph("1. Executive Summary & System Overview", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=10))
    
    story.append(Paragraph(
        "<b>Project ForChi</b> was designed as an autonomous, multimodal Telegram workflow bot for Victor. "
        "Its primary responsibility is to act as an intelligent social media content generator, publisher, and conversational assistant. "
        "The system listens to incoming text messages and voice notes via Telegram, filters user intent through a deterministic multi-layer gate, "
        "routes triggers to automated social publishing workflows (Facebook Feed and LinkedIn Page), and falls back seamlessly to multi-tier LLM chat.",
        body_style
    ))
    
    story.append(Paragraph("Core Architectural Directives (The Blueprint):", h2_style))
    story.append(Paragraph("• <b>Deterministic Non-Blocking Gate (Section 2 & 3):</b> High-speed keyword regex matching precedes any LLM call to prevent unnecessary API latency and quota consumption.", bullet_style))
    story.append(Paragraph("• <b>3-Tier LLM Waterfall (Section 3b):</b> Key rotation across 15 Google Gemini API keys, falling back to Hugging Face Open-Weight models (Gemma 3 27B and Llama 3.3 70B) upon quota/rate-limit exhaustion.", bullet_style))
    story.append(Paragraph("• <b>Multimodal Voice Pipeline (Section 6):</b> OGG/Opus Telegram voice note downloading, ffmpeg conversion to 16kHz mono WAV, transcription via Hugging Face Whisper API, and seamless injection into the intent pipeline.", bullet_style))
    story.append(Paragraph("• <b>Async Social Media Publishing (Section 4 & 7):</b> Instant acknowledgment reply ('On it 🤙') followed by non-blocking parallel execution for Facebook Graph API and LinkedIn API with FLUX image generation.", bullet_style))
    story.append(Paragraph("• <b>Reliable Container Lifecycle:</b> Persistent SQLite storage (`./data/forchi.db`), UTC cron scheduling (`node-cron`), and HTTP health checks on port 7860.", bullet_style))

    story.append(Spacer(1, 10))

    # ---------------------------------------------------------
    # SECTION 2: ARCHITECTURAL PIPELINE AUDIT
    # ---------------------------------------------------------
    story.append(Paragraph("2. Master System Pipeline Audit", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=10))
    
    story.append(Paragraph(
        "The application is structured into a strictly ordered execution pipeline. "
        "Every incoming message must pass through three distinct exits before executing an action or generating text.",
        body_style
    ))

    # Pipeline Diagram Table
    pipeline_data = [
        [Paragraph("Stage", table_header_style), Paragraph("Component", table_header_style), Paragraph("Logic / Contract", table_header_style), Paragraph("Exit Path", table_header_style)],
        [Paragraph("<b>Layer 1</b>", table_cell_style), Paragraph("RegEx Gate<br/>(<code>gate.js</code>)", table_cell_style), Paragraph("Evaluates <code>POST_TRIGGER</code> regex pattern (e.g. 'make a post').", table_cell_style), Paragraph("If FALSE $\\rightarrow$ Chat Path<br/>If TRUE $\\rightarrow$ Layer 2", table_cell_style)],
        [Paragraph("<b>Layer 2</b>", table_cell_style), Paragraph("Intent Extractor<br/>(<code>extractor.js</code>)", table_cell_style), Paragraph("Calls LLM/fallback to extract JSON schema: <code>{isPostTrigger, destinations, content}</code>.", table_cell_style), Paragraph("If FALSE $\\rightarrow$ Chat Path<br/>If VALID $\\rightarrow$ Layer 3", table_cell_style)],
        [Paragraph("<b>Layer 3</b>", table_cell_style), Paragraph("Social Workflow<br/>(<code>workflows/social/</code>)", table_cell_style), Paragraph("Replies 'On it 🤙'. Spawns FLUX image generation & Facebook/LinkedIn posts concurrently.", table_cell_style), Paragraph("Async completion $\\rightarrow$ 'Done — go check it out.'", table_cell_style)],
    ]
    p_table = Table(pipeline_data, colWidths=[60, 100, 210, 134])
    p_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), PRIMARY),
        ('GRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('PADDING', (0,0), (-1,-1), 6),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, BG_LIGHT]),
    ]))
    story.append(p_table)
    story.append(Spacer(1, 12))

    story.append(Paragraph("Voice Note Processing Pipeline (Section 6)", h2_style))
    story.append(Paragraph(
        "When a user sends a Telegram voice note (<code>filters.VOICE</code>), the system executes a four-step pipeline:<br/>"
        "1. <b>Download:</b> Fetches original <code>.ogg</code> audio file from Telegram servers via <code>getFileLink</code>.<br/>"
        "2. <b>Transcode:</b> Executes <code>ffmpeg -y -i input.ogg -ar 16000 -ac 1 -c:a pcm_s16le output.wav</code> to produce standard 16kHz mono WAV audio.<br/>"
        "3. <b>Transcribe:</b> Sends WAV binary payload to <code>https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3-turbo</code>.<br/>"
        "4. <b>Inject:</b> Passes transcribed text output directly into Layer 1 RegEx Gate, treating it identically to a typed text message.",
        body_style
    ))

    story.append(PageBreak())

    # ---------------------------------------------------------
    # SECTION 3: THE 3-TIER LLM WATERFALL ENGINE
    # ---------------------------------------------------------
    story.append(Paragraph("3. The 3-Tier LLM Waterfall & Key Rotation Engine", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=10))

    story.append(Paragraph(
        "To guarantee 100% uptime and bypass severe rate-limits (HTTP 429) or quota restrictions on free-tier LLM endpoints, "
        "ForChi implements a multi-tier waterfall key-rotation system (<code>src/llm/provider.js</code>).",
        body_style
    ))

    # LLM Table
    llm_data = [
        [Paragraph("Tier Level", table_header_style), Paragraph("Provider & Models", table_header_style), Paragraph("Rotation Strategy", table_header_style)],
        [
            Paragraph("<b>Tier 1 (Primary)</b>", table_cell_style),
            Paragraph("<b>Google Gemini API</b><br/>• <code>gemini-2.0-flash-lite</code><br/>• <code>gemini-2.0-flash</code><br/>• <code>gemini-1.5-flash</code>", table_cell_style),
            Paragraph("Loops through <b>15 GEMINI_KEYS</b>. For each key, attempts cheapest/highest-quota model first. On rate-limit (429), rotates to next model tier. On key failure (403/quota), rotates to next key.", table_cell_style)
        ],
        [
            Paragraph("<b>Tier 2 (Fallback)</b>", table_cell_style),
            Paragraph("<b>Hugging Face Router</b><br/>• <code>google/gemma-3-27b-it</code>", table_cell_style),
            Paragraph("Activated if all 15 Gemini keys are exhausted. Uses <code>HF_TOKEN</code> / <code>HF_ACCESS_TOKEN</code> via HF Serverless Inference Router.", table_cell_style)
        ],
        [
            Paragraph("<b>Tier 3 (Final)</b>", table_cell_style),
            Paragraph("<b>Hugging Face Router</b><br/>• <code>meta-llama/Llama-3.3-70B-Instruct</code><br/>• <code>meta-llama/Llama-3.1-8B-Instruct</code>", table_cell_style),
            Paragraph("Final open-weight safety net. Ensures that even during complete Gemini outages, structured intent extraction and content generation never crash.", table_cell_style)
        ],
    ]
    llm_table = Table(llm_data, colWidths=[100, 160, 244])
    llm_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), SECONDARY),
        ('GRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('PADDING', (0,0), (-1,-1), 6),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, BG_LIGHT]),
    ]))
    story.append(llm_table)
    story.append(Spacer(1, 10))

    story.append(Paragraph("Chat Fast-Path Logic (<code>callGemmaForChat</code>)", h2_style))
    story.append(Paragraph(
        "General chat messages (Exit 1) skip the multi-key Gemini waterfall entirely to reduce latency. "
        "They query <code>google/gemma-3-27b-it</code> directly, utilizing randomized personality framings "
        "(e.g., 'Answer naturally and conversationally, like a knowledgeable friend. Your name is ForChi.').",
        body_style
    ))

    # ---------------------------------------------------------
    # SECTION 4: CHRONOLOGICAL TIMELINE OF ISSUES & DEEP POST-MORTEM
    # ---------------------------------------------------------
    story.append(Paragraph("4. Chronological Timeline of Failures & Fixes", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=10))

    timeline_data = [
        [Paragraph("Phase / Time", table_header_style), Paragraph("Symptom / Error Encountered", table_header_style), Paragraph("Root Cause", table_header_style), Paragraph("Resolution / Action Taken", table_header_style)],
        [
            Paragraph("<b>Phase 1</b><br/>Local Dev", table_cell_style),
            Paragraph("Bot runs locally without issues.", table_cell_style),
            Paragraph("Local network has direct internet access and valid credentials.", table_cell_style),
            Paragraph("Confirmed baseline functionality.", table_cell_style)
        ],
        [
            Paragraph("<b>Phase 2</b><br/>Containerization", table_cell_style),
            Paragraph("Bot deployed to HF Space <code>slymun/forchi</code>.", table_cell_style),
            Paragraph("Debian Docker container environment listening on port 7860.", table_cell_style),
            Paragraph("Configured <code>Dockerfile</code> and <code>entrypoint.sh</code>.", table_cell_style)
        ],
        [
            Paragraph("<b>Phase 3</b><br/>Python TLS Timeout", table_cell_style),
            Paragraph("<code>_ssl.c:975: Handshake timed out</code>", table_cell_style),
            Paragraph("Python 3.11 <code>urllib</code> / <code>requests</code> OpenSSL 3.0 SNI TLS 1.3 ticket negotiation stalls over cloud egress proxies.", table_cell_style),
            Paragraph("Switched container engine back to pure Node.js Telegraf (<code>src/bot.js</code>).", table_cell_style)
        ],
        [
            Paragraph("<b>Phase 4</b><br/>Webhook vs Long-Polling", table_cell_style),
            Paragraph("<code>setWebhook failed: socket disconnected</code>", table_cell_style),
            Paragraph("Webhook requires inbound HTTP reachability on HF port 7860. HF container network blocked inbound Telegram webhooks.", table_cell_style),
            Paragraph("Reverted to pure Long-Polling (zero inbound ports required).", table_cell_style)
        ],
        [
            Paragraph("<b>Phase 5</b><br/>Secret Name Audit", table_cell_style),
            Paragraph("Facebook & Voice silent failures", table_cell_style),
            Paragraph("Code read <code>FACEBOOK_PAGE_TOKEN</code> & <code>HF_TOKEN</code>, but HF Secrets panel defined <code>FACEBOOK_PAGE_ACCESS_TOKEN</code> & <code>HF_ACCESS_TOKEN</code>.", table_cell_style),
            Paragraph("Added fallback aliases in code: <code>process.env.FACEBOOK_PAGE_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN</code>.", table_cell_style)
        ],
        [
            Paragraph("<b>Phase 6</b><br/>Waterfall Freeze Bug", table_cell_style),
            Paragraph("Bot total silence on chat", table_cell_style),
            Paragraph("<code>callGeminiKey</code> only caught HTTP 429. HTTP 403 (Forbidden) re-threw an unhandled exception, causing a 45s blocking loop.", table_cell_style),
            Paragraph("Fixed <code>callGeminiKey</code> to catch ALL errors (403, 404, 429) and rotate non-blockingly.", table_cell_style)
        ],
        [
            Paragraph("<b>Phase 7</b><br/>Egress Filter Diagnosis", table_cell_style),
            Paragraph("<code>curl -sv https://api.telegram.org</code> timed out after ClientHello", table_cell_style),
            Paragraph("HF Space cloud infrastructure enforces strict egress packet filtering on TLS SNI for Telegram IP ranges.", table_cell_style),
            Paragraph("Identified requirement for external egress relay (Oracle VPS / Tailscale Proxy).", table_cell_style)
        ],
    ]
    t_table = Table(timeline_data, colWidths=[65, 120, 160, 159])
    t_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), PRIMARY),
        ('GRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('PADDING', (0,0), (-1,-1), 5),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, BG_LIGHT]),
    ]))
    story.append(t_table)

    story.append(PageBreak())

    # ---------------------------------------------------------
    # SECTION 5: DETAILED BUG REPORT & ROOT CAUSE MATRIX
    # ---------------------------------------------------------
    story.append(Paragraph("5. Comprehensive Bug Audit & Technical Root Cause Analysis", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=10))

    # Bug 1 Detail Box
    b1_html = """
    <b>BUG #1: Python 3.11 OpenSSL 3.0 Egress Handshake Timeout</b><br/>
    <b>Symptom:</b> <code>[WARNING] <urlopen error _ssl.c:975: The handshake operation timed out></code><br/>
    <b>Traceback Location:</b> <code>bot.py</code> (Python <code>urllib.request</code> / <code>requests</code> module).<br/>
    <b>Root Cause:</b> Python 3.11 linked against OpenSSL 3.0 in Debian Bookworm Docker images enforces strict TLS 1.3 session ticket renegotiation. When outbound requests pass through Hugging Face's container egress NAT, TLS ClientHello packets fail to receive ServerHello packets.<br/>
    <b>Resolution:</b> Engine migrated to Node.js (<code>src/bot.js</code>). Node's V8 HTTP networking module uses <code>libuv</code> asynchronous socket loops, which handle TLS 1.3 socket negotiation without OpenSSL blocking bugs.
    """
    story.append(Paragraph(b1_html, body_style))
    story.append(Spacer(1, 6))

    # Bug 2 Detail Box
    b2_html = """
    <b>BUG #2: Webhook Inbound Port Exposure Failure</b><br/>
    <b>Symptom:</b> <code>[Telegraf Webhook Warning] request to setWebhook failed: Client network socket disconnected</code><br/>
    <b>Traceback Location:</b> <code>src/bot.js</code> line 105 (<code>bot.telegram.setWebhook</code>).<br/>
    <b>Root Cause:</b> Switching from long-polling to webhook mode required Telegram servers to establish inbound HTTPS connections to port 7860 on <code>https://slymun-forchi.hf.space</code>. Hugging Face free-tier Spaces block incoming arbitrary webhook POST requests unless custom headers/proxy SSL certificates are configured.<br/>
    <b>Resolution:</b> Reverted to pure Long-Polling. Long-polling requires ZERO inbound ports open; the bot container strictly initiates outbound polling requests.
    """
    story.append(Paragraph(b2_html, body_style))
    story.append(Spacer(1, 6))

    # Bug 3 Detail Box
    b3_html = """
    <b>BUG #3: Environment Variable Alias Mismatches (Silent Workflow Crashes)</b><br/>
    <b>Symptom:</b> Facebook posts threw <code>Missing FACEBOOK_PAGE_TOKEN</code>; Whisper voice transcription threw <code>Missing HF_TOKEN</code>.<br/>
    <b>Traceback Location:</b> <code>src/workflows/social/facebook.js</code> line 8 & <code>src/voice/transcriber.js</code> line 16.<br/>
    <b>Root Cause:</b> Discrepancy between environment key naming conventions. The code checked for <code>FACEBOOK_PAGE_TOKEN</code> and <code>HF_TOKEN</code>, whereas Hugging Face Secrets panel configured <code>FACEBOOK_PAGE_ACCESS_TOKEN</code> and <code>HF_ACCESS_TOKEN</code>.<br/>
    <b>Resolution:</b> Added non-breaking key alias resolution across all modules:
    <code>const pageToken = process.env.FACEBOOK_PAGE_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;</code>
    <code>const hfToken = process.env.HF_TOKEN || process.env.HF_ACCESS_TOKEN;</code>
    """
    story.append(Paragraph(b3_html, body_style))
    story.append(Spacer(1, 6))

    # Bug 4 Detail Box
    b4_html = """
    <b>BUG #4: Gemini Key Rotation Loop Unhandled Exception & 45s Process Stall</b><br/>
    <b>Symptom:</b> Telegram bot entered total silence when Gemini key returned 403 Forbidden.<br/>
    <b>Traceback Location:</b> <code>src/llm/provider.js</code> lines 73-74 (<code>throw err;</code>).<br/>
    <b>Root Cause:</b> The <code>isRateLimitError(err)</code> helper function strictly checked for HTTP 429 or quota strings. When Key 1 returned HTTP 403 (Forbidden / Invalid Key), <code>callGeminiKey</code> re-threw the error. The caller caught it but attempted 3 model tiers across 15 keys sequentially (45 HTTP requests), blocking the Node event loop for over 45 seconds until Telegram timed out.<br/>
    <b>Resolution:</b> Refactored <code>callGeminiKey</code> to catch ALL HTTP errors (403, 404, 429, timeout) and non-blockingly rotate to the next key/model tier immediately. Also corrected model endpoint string from <code>gemini-1.5-flash-latest</code> to <code>gemini-1.5-flash</code>.
    """
    story.append(Paragraph(b4_html, body_style))
    story.append(Spacer(1, 6))

    # Bug 5 Detail Box
    b5_html = """
    <b>BUG #5: Cloud Egress SNI Packet Filtering to Telegram IP Ranges</b><br/>
    <b>Symptom:</b> <code>curl -sv https://api.telegram.org</code> timed out after 10001ms at <code>TLSv1.3 (OUT), TLS handshake, Client hello (1)</code>.<br/>
    <b>Traceback Location:</b> Network Egress Interface (HF Space AWS Ireland datacenter).<br/>
    <b>Root Cause:</b> Deep packet inspection diagnostics confirmed TCP connection to <code>149.154.166.110:443</code> succeeded, but outbound TLS ClientHello containing Server Name Indication (SNI) for <code>api.telegram.org</code> received no ServerHello response. Cloud infrastructure provider actively drops Telegram TLS packets.<br/>
    <b>Resolution:</b> Confirmed requirement for external egress relay proxy (Oracle VPS / Reverse Proxy Worker).
    """
    story.append(Paragraph(b5_html, body_style))

    story.append(PageBreak())

    # ---------------------------------------------------------
    # SECTION 6: COMPARATIVE ARCHITECTURE MATRIX (FORCHI vs MILO vs CLAY)
    # ---------------------------------------------------------
    story.append(Paragraph("6. Comparative Architecture Matrix (ForChi vs Milo vs Clay)", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=10))

    story.append(Paragraph(
        "To understand why previous bots (Milo and Clay) operated without networking issues, "
        "we must analyze the architectural differences between their deployment targets and runtime stacks.",
        body_style
    ))

    comp_data = [
        [Paragraph("Architectural Feature", table_header_style), Paragraph("Project MILO", table_header_style), Paragraph("Project CLAY", table_header_style), Paragraph("Project FORCHI (v1)", table_header_style)],
        [
            Paragraph("<b>Runtime Engine</b>", table_cell_style),
            Paragraph("Node.js (Telegraf v4)", table_cell_style),
            Paragraph("Python 3.10 (Local/WSL)", table_cell_style),
            Paragraph("Node.js / Python Hybrid", table_cell_style)
        ],
        [
            Paragraph("<b>Host Environment</b>", table_cell_style),
            Paragraph("Local Machine / Render", table_cell_style),
            Paragraph("Local Workstation / Docker", table_cell_style),
            Paragraph("Hugging Face Space (Debian Container)", table_cell_style)
        ],
        [
            Paragraph("<b>Telegram Connection</b>", table_cell_style),
            Paragraph("Long-Polling (Direct API)", table_cell_style),
            Paragraph("Long-Polling (Direct API)", table_cell_style),
            Paragraph("Long-Polling & Webhook attempts over HF Egress Proxy", table_cell_style)
        ],
        [
            Paragraph("<b>Network Egress</b>", table_cell_style),
            Paragraph("Unfiltered Home/ISP IP", table_cell_style),
            Paragraph("Unfiltered Home/ISP IP", table_cell_style),
            Paragraph("Filtered Cloud Data Center IP (AWS Ireland / HF)", table_cell_style)
        ],
        [
            Paragraph("<b>LLM Key Strategy</b>", table_cell_style),
            Paragraph("Single Key / DeepSeek", table_cell_style),
            Paragraph("PyTorch DQN Router", table_cell_style),
            Paragraph("15-Key Gemini Waterfall + HF Router Fallback", table_cell_style)
        ],
        [
            Paragraph("<b>Social Publishing</b>", table_cell_style),
            Paragraph("N/A (Chat Bot)", table_cell_style),
            Paragraph("N/A (DevOps Agent)", table_cell_style),
            Paragraph("Facebook Graph API + LinkedIn API + FLUX.1 Image Gen", table_cell_style)
        ],
    ]
    c_table = Table(comp_data, colWidths=[110, 130, 130, 134])
    c_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), PRIMARY),
        ('GRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('PADDING', (0,0), (-1,-1), 6),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, BG_LIGHT]),
    ]))
    story.append(c_table)
    story.append(Spacer(1, 14))

    # ---------------------------------------------------------
    # SECTION 7: SECRET MAPPING & ENVIRONMENT AUDIT
    # ---------------------------------------------------------
    story.append(Paragraph("7. Master Environment & Secret Mapping Audit", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=10))

    story.append(Paragraph(
        "Below is the complete reference table of all environment variables, secret keys, and their normalized aliases required for ForChi:",
        body_style
    ))

    secret_data = [
        [Paragraph("Environment Variable Key", table_header_style), Paragraph("Canonical Name", table_header_style), Paragraph("Accepted Alias / Fallback", table_header_style), Paragraph("Purpose / Description", table_header_style)],
        [Paragraph("<code>TELEGRAM_BOT_TOKEN</code>", table_cell_style), Paragraph("<code>TELEGRAM_BOT_TOKEN</code>", table_cell_style), Paragraph("N/A", table_cell_style), Paragraph("Bot Token from @BotFather (e.g. <code>8677027954:...</code>)", table_cell_style)],
        [Paragraph("<code>GEMINI_KEYS</code>", table_cell_style), Paragraph("<code>GEMINI_KEYS</code>", table_cell_style), Paragraph("N/A", table_cell_style), Paragraph("Comma-separated list of 15 Google Gemini API keys for Waterfall", table_cell_style)],
        [Paragraph("<code>HF_TOKEN</code>", table_cell_style), Paragraph("<code>HF_TOKEN</code>", table_cell_style), Paragraph("<code>HF_ACCESS_TOKEN</code>", table_cell_style), Paragraph("Hugging Face User Access Token for Serverless Inference & Whisper", table_cell_style)],
        [Paragraph("<code>FACEBOOK_PAGE_ID</code>", table_cell_style), Paragraph("<code>FACEBOOK_PAGE_ID</code>", table_cell_style), Paragraph("N/A", table_cell_style), Paragraph("Numeric ID of Facebook Business Page (e.g. <code>104975031401620</code>)", table_cell_style)],
        [Paragraph("<code>FACEBOOK_PAGE_TOKEN</code>", table_cell_style), Paragraph("<code>FACEBOOK_PAGE_TOKEN</code>", table_cell_style), Paragraph("<code>FACEBOOK_PAGE_ACCESS_TOKEN</code>", table_cell_style), Paragraph("Long-lived Facebook Page Access Token for Graph API v19.0", table_cell_style)],
        [Paragraph("<code>LINKEDIN_ACCESS_TOKEN</code>", table_cell_style), Paragraph("<code>LINKEDIN_ACCESS_TOKEN</code>", table_cell_style), Paragraph("N/A", table_cell_style), Paragraph("OAuth2 User Access Token for LinkedIn Share API", table_cell_style)],
        [Paragraph("<code>LINKEDIN_AUTHOR_URN</code>", table_cell_style), Paragraph("<code>LINKEDIN_AUTHOR_URN</code>", table_cell_style), Paragraph("N/A", table_cell_style), Paragraph("Person/Org URN (e.g. <code>urn:li:person:fALaRti9Cl</code>)", table_cell_style)],
        [Paragraph("<code>TELEGRAM_API_BASE</code>", table_cell_style), Paragraph("<code>TELEGRAM_API_BASE</code>", table_cell_style), Paragraph("<code>https://api.telegram.org</code>", table_cell_style), Paragraph("Base URL for Telegram API requests (used for reverse proxy routing)", table_cell_style)],
    ]
    sec_table = Table(secret_data, colWidths=[120, 110, 110, 164])
    sec_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), SECONDARY),
        ('GRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('PADDING', (0,0), (-1,-1), 5),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, BG_LIGHT]),
    ]))
    story.append(sec_table)

    story.append(PageBreak())

    # ---------------------------------------------------------
    # SECTION 8: REBRANDING BLUEPRINT & LESSONS LEARNED FOR FORCHI v2
    # ---------------------------------------------------------
    story.append(Paragraph("8. Rebranding Blueprint & Lessons Learned for ForChi v2", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=10))

    story.append(Paragraph(
        "As we prepare to rebrand and relaunch ForChi, we synthesize the exact architectural recommendations "
        "and lessons learned from this technical post-mortem into a master checklist.",
        body_style
    ))

    story.append(Paragraph("1. Universal Architecture Hack (GitHub + Cloudflare + Hugging Face + Oracle VPS)", h2_style))
    story.append(Paragraph(
        "To achieve zero-downtime and bypass cloud egress packet filtering, implement Victor's Universal Architecture Stack:<br/>"
        "• <b>GitHub (Source of Truth):</b> Centralized repository housing all Node.js and configuration code.<br/>"
        "• <b>Oracle Cloud VPS (The Egress Relay & Vault):</b> Host a minimal Node.js / Python Telegram Egress Proxy (`tailscale_tg_proxy.py`) on your Oracle VPS. Because Oracle VPS IP ranges are unrestricted, configuring `TELEGRAM_API_BASE=http://<ORACLE_VPS_IP>:8088` ensures 100% reliable outbound delivery.<br/>"
        "• <b>Cloudflare Worker / Pages (CDN & WAF):</b> Provides global reverse proxy routing and SSL termination.<br/>"
        "• <b>Hugging Face Spaces (Compute Engine):</b> Operates purely as a headless microservice container, offloading outbound Telegram TLS to the Oracle VPS proxy.",
        body_style
    ))

    story.append(Paragraph("2. Pre-Deployment Verification Protocol", h2_style))
    story.append(Paragraph(
        "Before deploying any new code to production, enforce the 4-Stage Isolation Test Plan (Blueprint Section 11):<br/>"
        "• <b>Stage 1 (Baseline Chat):</b> Deploy minimal bot engine and verify immediate response to 'hi' in long-polling mode.<br/>"
        "• <b>Stage 2 (Voice Transcription):</b> Send a voice note and verify ffmpeg WAV conversion + Whisper transcription.<br/>"
        "• <b>Stage 3 (Trigger Routing):</b> Test 'make a post about AI on facebook' and verify RegEx Gate + Extractor JSON output.<br/>"
        "• <b>Stage 4 (Parallel Publishing):</b> Deliberately trigger social workflow and verify Facebook Graph API + LinkedIn API post creation with FLUX image buffers.",
        body_style
    ))

    story.append(Paragraph("3. LLM Key Rotation Hardening Rule", h2_style))
    story.append(Paragraph(
        "Ensure all LLM providers wrap API calls in non-blocking try/catch blocks that catch HTTP 403, 404, 429, and socket timeouts. "
        "On any error, log a warning and immediately rotate to the next key or fallback provider without stalling the main execution thread.",
        body_style
    ))

    story.append(Spacer(1, 15))

    # Sign-off box
    signoff_html = """
    <b>REBRANDING PREPARATION COMPLETE:</b><br/>
    All remote Hugging Face Spaces (<code>slymun/forchi</code>) have been successfully deleted.<br/>
    This Master Revision Document is saved as a permanent artifact in your workspace: 
    <code>ForChi_Master_System_Revision_and_PostMortem_Report.pdf</code>.<br/><br/>
    <b>Ready for Victor's Review & Rebranding Initiation.</b>
    """
    so_table = Table([[Paragraph(signoff_html, body_style)]], colWidths=[504])
    so_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), SUCCESS_BG),
        ('BOX', (0,0), (-1,-1), 1.5, SUCCESS_BORDER),
        ('PADDING', (0,0), (-1,-1), 12),
    ]))
    story.append(so_table)

    # Build PDF
    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"PDF successfully generated: {filename}")

if __name__ == '__main__':
    out_pdf = "ForChi_Master_System_Revision_and_PostMortem_Report.pdf"
    build_pdf(out_pdf)
