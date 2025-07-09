const vscode = acquireVsCodeApi();
let currentQuestionId = null;
let questions = [];

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
}

function updateQuestionDisplay() {
  const questionText = document.getElementById("question-text");
  const selectedQuestion = questions.find((q) => q.id === currentQuestionId);

  if (selectedQuestion) {
    questionText.innerHTML = selectedQuestion.question;
    questionText.style.display = "block";

    if (typeof Prism !== "undefined") {
      Prism.highlightAllUnder(questionText);
    }
  } else {
    questionText.style.display = "none";
  }
}

function selectQuestion(questionId) {
  currentQuestionId = questionId;
  updateQuestionDisplay();
  updateQuestionSelector();
}

function updateQuestionSelector() {
  const selector = document.getElementById("question-selector");
  const dropdown = document.getElementById("question-dropdown");

  if (questions.length <= 1) {
    selector.classList.remove("show");
    return;
  }

  selector.classList.add("show");
  dropdown.innerHTML = "";

  questions.forEach((q) => {
    if (q.id !== currentQuestionId) {
      const option = document.createElement("div");
      option.className = "question-option";
      const plainText = stripHtml(q.question);
      option.textContent = `${plainText.substring(0, 60)}${plainText.length > 60 ? "..." : ""}`;
      option.addEventListener("click", () => {
        selectQuestion(q.id);
        toggleDropdown(false);
      });
      dropdown.appendChild(option);
    }
  });
}

function toggleDropdown(show) {
  const dropdown = document.getElementById("question-dropdown");

  if (show === undefined) {
    show = dropdown.style.display === "none";
  }

  dropdown.style.display = show ? "block" : "none";
}

function sendAnswer() {
  const answerTextarea = document.getElementById("answer-textarea");
  const answer = answerTextarea.value.trim();

  if (answer && currentQuestionId) {
    vscode.postMessage({
      type: "answer",
      answer,
      questionId: currentQuestionId,
    });
    answerTextarea.value = "";
  }
}

window.addEventListener("message", (event) => {
  const message = event.data;

  if (message.type === "questions") {
    questions = message.questions;

    if (questions.length > 0) {
      document.getElementById("no-question").style.display = "none";
      document.getElementById("question-container").style.display = "block";

      selectQuestion(questions[0].id);
    } else {
      document.getElementById("question-container").style.display = "none";
      document.getElementById("no-question").style.display = "block";
    }
  }
});

document
  .getElementById("question-selector-button")
  .addEventListener("click", () => {
    toggleDropdown();
  });

document.addEventListener("click", (e) => {
  const selector = document.getElementById("question-selector");
  if (!selector.contains(e.target)) {
    toggleDropdown(false);
  }
});

document.getElementById("send-button").addEventListener("click", sendAnswer);

document.getElementById("answer-textarea").addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "Enter") {
    e.preventDefault();
    sendAnswer();
  }
});
