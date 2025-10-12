// Import necessary packages
const express = require('express');
const axios = require('axios');
const path = require('path');
const docx = require('docx');
require('dotenv').config(); // To manage environment variables

// Destructure necessary components from docx
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, HorizontalRule } = docx;

// Initialize the Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware setup
app.use(express.json({ limit: '5mb' })); // Increase payload size limit
app.use(express.static(path.join(__dirname))); // Serve static files like index.html

// --- Helper function for Gemini API call ---
const callGeminiApi = async (prompt, isJson = false) => {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        throw new Error('API key not found. Please set it in the .env file.');
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;
    
    try {
        const payload = { contents: [{ parts: [{ text: prompt }] }] };
        if (isJson) {
            payload.generationConfig = { responseMimeType: "application/json" };
        }
        const response = await axios.post(apiUrl, payload, {
            headers: { 'Content-Type': 'application/json' }
        });
        const generatedText = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (generatedText) {
            return generatedText;
        } else {
            throw new Error("The API returned an empty or invalid response.");
        }
    } catch (error) {
        console.error('Error calling Gemini API:', error.response ? error.response.data : error.message);
        throw new Error('Failed to get a response from the AI model.');
    }
};


// --- API Endpoint for Resume Generation ---
app.post('/api/generate', async (req, res) => {
    const { studentData, jobDescription } = req.body;
    if (!studentData) {
        return res.status(400).json({ error: 'Student data is required.' });
    }
    const prompt = `
        Act as an expert resume writer. Based on the provided data, create a professional resume.
        Return the entire output as a single, valid JSON object. Do not include any text or markdown formatting before or after the JSON.

        The JSON object must have this exact structure:
        {
          "name": "Full Name",
          "title": "Professional Title (e.g., Professional Accountant)",
          "contact": {
            "phone": "Phone Number",
            "email": "Email Address",
            "address": "City, State"
          },
          "summary": "A paragraph for the 'ABOUT ME' section.",
          "sections": [
            {
              "title": "EDUCATION",
              "items": [
                {
                  "heading": "University Name | Dates (e.g., 2026-2030)",
                  "subheading": "Degree, Major",
                  "description": "A single paragraph with details about coursework or achievements."
                }
              ]
            },
            {
              "title": "WORK EXPERIENCE",
              "items": [
                {
                  "heading": "Company | Dates (e.g., 2033 - 2035)",
                  "subheading": "Job Title",
                  "description": "A single paragraph describing responsibilities and accomplishments."
                }
              ]
            },
            {
              "title": "PROJECTS",
              "items": [
                {
                  "heading": "Project Name",
                  "subheading": "Technologies Used",
                  "description": "A single paragraph describing the project."
                }
              ]
            },
            {
              "title": "SKILLS",
              "items": ["Skill 1", "Skill 2", "Skill 3", "Skill 4", "Skill 5", "Skill 6"]
            }
          ],
          "atsScore": "An ATS score as a percentage (e.g., '91%')",
          "suggestions": "A string containing 2-3 actionable suggestions for improvement, separated by newlines."
        }
        
        **Student's Raw Information:**
        ---
        ${studentData}
        ---

        **Target Job Description:**
        ---
        ${jobDescription || 'None provided. Generate a strong, general-purpose resume.'}
        ---
    `;
    try {
        const jsonResponse = await callGeminiApi(prompt, true);
        const resumeData = JSON.parse(jsonResponse);

        let resumeHtmlForWeb = `<h2>${resumeData.name}</h2><p><strong>${resumeData.title}</strong></p>`;
        resumeHtmlForWeb += `<h3>ABOUT ME</h3><p>${resumeData.summary}</p>`;

        resumeData.sections.forEach(section => {
            resumeHtmlForWeb += `<h3>${section.title}</h3>`;
            if (section.title.toUpperCase() === 'SKILLS') {
                resumeHtmlForWeb += `<ul>${section.items.map(item => `<li>${item}</li>`).join('')}</ul>`;
            } else {
                section.items.forEach(item => {
                    resumeHtmlForWeb += `<p><strong>${item.heading}</strong></p>`;
                    if (item.subheading) resumeHtmlForWeb += `<p><em>${item.subheading}</em></p>`;
                    if (item.description) resumeHtmlForWeb += `<p>${item.description}</p>`;
                });
            }
        });

        res.json({
            resumeText: resumeHtmlForWeb,
            resumeData,
            atsScore: resumeData.atsScore,
            suggestions: resumeData.suggestions
        });

    } catch (error) {
        console.error("Error processing generation request:", error);
        res.status(500).json({ error: "Failed to generate structured resume data. The AI response might be malformed." });
    }
});

// --- API Endpoint to create and download a DOCX file ---
app.post('/api/download-docx', async (req, res) => {
    const { resumeData } = req.body;
    if (!resumeData) {
        return res.status(400).json({ error: 'Structured resume data is required.' });
    }

    try {
        const doc = new Document({
              styles: {
                  paragraphStyles: [
                      {
                          id: "default",
                          name: "Default",
                          basedOn: "Normal",
                          next: "Normal",
                          quickFormat: true,
                          run: { font: "Calibri", size: 22 },
                      },
                       {
                          id: "heading",
                          name: "Heading",
                          basedOn: "Normal",
                          next: "Normal",
                          quickFormat: true,
                          run: { font: "Calibri Light", size: 32, bold: true, allCaps: true },
                          paragraph: { spacing: { before: 200, after: 100 } },
                      },
                  ],
              },
              sections: [{
                  properties: { },
                  children: buildDocxFromJSON(resumeData),
              }],
        });

        const buffer = await Packer.toBuffer(doc);
        res.writeHead(200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition': 'attachment; filename=resume.docx',
        });
        res.end(buffer);

    } catch (error) {
        console.error("Error creating DOCX:", error);
        res.status(500).json({ error: "Failed to create DOCX file." });
    }
});

function buildDocxFromJSON(data) {
    const FONT_FAMILY = "Calibri";

    const createSectionHeading = (text) => new Paragraph({
        children: [new TextRun({ text, font: FONT_FAMILY, size: 24, bold: true, allCaps: true })],
        spacing: { before: 300, after: 150 },
        border: { bottom: { color: "auto", space: 1, value: "single", size: 6 } },
    });

    return [
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: data.name || "Full Name", font: FONT_FAMILY, size: 56, bold: true })],
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: data.title || "Professional Title", font: FONT_FAMILY, size: 24, color: "555555" })],
            spacing: { after: 100 },
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
                new TextRun({ text: data.contact?.phone || "", font: FONT_FAMILY, size: 22 }),
                new TextRun({ text: " | ", font: FONT_FAMILY, size: 22, color: "AAAAAA" }),
                new TextRun({ text: data.contact?.email || "", font: FONT_FAMILY, size: 22 }),
                new TextRun({ text: " | ", font: FONT_FAMILY, size: 22, color: "AAAAAA" }),
                new TextRun({ text: data.contact?.address || "", font: FONT_FAMILY, size: 22 }),
            ],
            spacing: { after: 300 },
        }),
        createSectionHeading("ABOUT ME"),
        new Paragraph({
            children: [new TextRun({ text: data.summary || "", font: FONT_FAMILY, size: 22 })],
            spacing: { after: 300 },
        }),
        ...data.sections.flatMap(section => {
            const sectionChildren = [createSectionHeading(section.title)];

            if (section.title.toUpperCase() === 'SKILLS' && Array.isArray(section.items)) {
                sectionChildren.push(
                    new Paragraph({
                        children: section.items.map((skill, index) => new TextRun({
                            text: `${skill}${index < section.items.length - 1 ? ' • ' : ''}`,
                            font: FONT_FAMILY,
                            size: 22,
                        })),
                    })
                );
            } else {
                (section.items || []).forEach(item => {
                    sectionChildren.push(
                        new Paragraph({
                            children: [new TextRun({ text: item.heading || "", font: FONT_FAMILY, size: 22, bold: true })],
                            spacing: { before: 200 },
                        }),
                        new Paragraph({
                            children: [new TextRun({ text: item.subheading || "", font: FONT_FAMILY, size: 22, italics: true, color: "555555" })],
                        }),
                        new Paragraph({
                            children: [new TextRun({ text: item.description || "", font: FONT_FAMILY, size: 22 })],
                            spacing: { after: 200 },
                        })
                    );
                });
            }
            return sectionChildren;
        })
    ];
}

// --- API Endpoint to Improve a Description ---
app.post('/api/improve', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text to improve is required.' });
    const prompt = `Rewrite the following resume description to be more professional and impactful. Use strong action verbs and focus on achievements. Keep it concise. Original text: "${text}"`;
    try {
        const improvedText = await callGeminiApi(prompt);
        res.json({ improvedText });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- API Endpoint for Cover Letter Generation ---
app.post('/api/generate-cover-letter', async (req, res) => {
    const { studentData, jobDescription, resumeData } = req.body; 
    if (!studentData || !jobDescription || !resumeData) {
        return res.status(400).json({ error: 'Missing required data.' });
    }
    let plainResumeText = `${resumeData.name.toUpperCase()}\n${resumeData.title}\n\n`;
    plainResumeText += `ABOUT ME\n${resumeData.summary}\n\n`;
    resumeData.sections.forEach(section => {
        plainResumeText += `${section.title.toUpperCase()}\n`;
        if (section.title.toUpperCase() === 'SKILLS') {
            plainResumeText += `- ${section.items.join('\n- ')}\n`;
        } else {
            (section.items || []).forEach(item => {
                plainResumeText += `${item.heading}\n${item.subheading}\n${item.description}\n`;
            });
        }
        plainResumeText += '\n';
    });
    const prompt = `Based on the student's info, their resume, and the job description, write a professional cover letter.\n\n**Student Info:**\n${studentData}\n\n**Resume:**\n${plainResumeText}\n\n**Job Description:**\n${jobDescription}`;
    
    try {
        const coverLetterText = await callGeminiApi(prompt);
        res.json({ coverLetterText });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- API Endpoint for Interview Prep Generation ---
app.post('/api/generate-interview-prep', async (req, res) => {
    const { studentData, jobDescription } = req.body;
    if (!studentData) return res.status(400).json({ error: 'Student data is required.' });
    const prompt = `Act as a career coach. Based on the student's info and job description, generate 3-4 behavioral interview questions. For each, provide a sample answer using the STAR method based on their experience.\n\n**Student Info:**\n${studentData}\n\n**Job Description:**\n${jobDescription || 'General role in their field.'}`;
    try {
        const interviewPrepText = await callGeminiApi(prompt);
        res.json({ interviewPrepText });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ✨ REVISED: API Endpoint for Portfolio Website Generation Using a Template ---
app.post('/api/generate-portfolio', async (req, res) => {
    const { resumeData } = req.body;
    if (!resumeData) {
        return res.status(400).json({ error: 'Resume data is required to generate a portfolio.' });
    }

    const portfolioTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{name}} - Portfolio</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; }
        a { text-decoration: none; color: inherit; }
        ul { list-style: none; }
        header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-align: center; padding: 2rem 1rem; }
        header h1 { font-size: 2.5rem; margin-bottom: 0.5rem; }
        header p { font-size: 1.2rem; opacity: 0.9; }
        nav { background: #333; padding: 1rem; position: sticky; top: 0; z-index: 100; }
        nav ul { display: flex; justify-content: center; flex-wrap: wrap; }
        nav li { margin: 0 1rem; }
        nav a { color: white; font-weight: bold; transition: color 0.3s; }
        nav a:hover { color: #667eea; }
        section { padding: 3rem 1rem; max-width: 1200px; margin: 0 auto; }
        h2 { text-align: center; font-size: 2rem; margin-bottom: 2rem; color: #333; }
        #about { background: white; text-align: center; }
        #about p { max-width: 800px; margin: 0 auto; font-size: 1.1rem; }
        #skills { background: #f4f4f4; }
        .skills-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; text-align: center; }
        .skill-item { background: white; padding: 1rem; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        #projects { background: white; }
        .projects-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem; }
        .project-card { background: #f9f9f9; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 8px rgba(0,0,0,0.1); transition: transform 0.3s; }
        .project-card:hover { transform: translateY(-5px); }
        .project-card img { width: 100%; height: 200px; object-fit: cover; }
        .project-card h3 { padding: 1rem; font-size: 1.3rem; }
        .project-card p { padding: 0 1rem 1rem; }
        .project-tech { padding: 0 1rem 1rem; font-style: italic; color: #667eea; }
        #contact { background: #f4f4f4; text-align: center; }
        footer { background: #333; color: white; text-align: center; padding: 1rem; }
    </style>
</head>
<body>
    <header>
        <h1>{{name}}</h1>
        <p>{{title}}</p>
    </header>
    <nav>
        <ul>
            <li><a href="#about">About</a></li>
            <li><a href="#skills">Skills</a></li>
            <li><a href="#projects">Projects</a></li>
            <li><a href="#contact">Contact</a></li>
        </ul>
    </nav>
    <section id="about">
        <h2>About Me</h2>
        <p>{{summary}}</p>
    </section>
    <section id="skills">
        <h2>Skills</h2>
        <div class="skills-grid" id="skillsList">
            <!-- SKILLS WILL BE INJECTED HERE -->
        </div>
    </section>
    <section id="projects">
        <h2>Projects</h2>
        <div class="projects-grid" id="projectsList">
            <!-- PROJECTS WILL BE INJECTED HERE -->
        </div>
    </section>
    <section id="contact">
        <h2>Contact</h2>
        <p>Let's connect! Email: <a href="mailto:{{email}}">{{email}}</a> | Phone: {{phone}}</p>
    </section>
    <footer>
        <p>&copy; 2025 {{name}}. All rights reserved.</p>
    </footer>
</body>
</html>
    `;

    const prompt = `
        You are a templating engine. Your task is to take the provided HTML template and populate it with the user's data from the JSON object.
        
        **CRITICAL INSTRUCTIONS:**
        1.  **Fill Simple Placeholders:** Replace all placeholders like \`{{name}}\`, \`{{title}}\`, \`{{summary}}\`, \`{{email}}\`, and \`{{phone}}\` with the corresponding values from the JSON data.
        2.  **Generate Dynamic Sections:**
            - For the 'SKILLS' section, find the "SKILLS" section in the JSON data. Iterate through its "items" array. For each skill, create a \`<div class="skill-item"><strong>SKILL_NAME</strong></div>\` and inject it inside the \`<div id="skillsList"></div>\`.
            - For the 'PROJECTS' section, find the "PROJECTS" section in the JSON data. Iterate through its "items" array. For each project, create a project card using this exact HTML structure: \`<div class="project-card"><img src="https://via.placeholder.com/300x200?text=Project+Image" alt="{{heading}}"><h3>{{heading}}</h3><p>{{description}}</p><div class="project-tech">{{subheading}}</div></div>\`. Replace the placeholders with the 'heading', 'subheading', and 'description' from each project item.
        3.  **Output:** Return only the final, complete, and valid HTML code. Do not include any explanations, markdown formatting, or comments.

        **HTML TEMPLATE:**
        ---
        ${portfolioTemplate}
        ---

        **USER DATA (JSON):**
        ---
        ${JSON.stringify(resumeData, null, 2)}
        ---
    `;

    try {
        const portfolioHtml = await callGeminiApi(prompt);
        res.json({ portfolioHtml });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Serve the Frontend ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
